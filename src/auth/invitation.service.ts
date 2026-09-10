import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { AdminPrismaService } from '../admin-prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(private readonly prisma: AdminPrismaService) {}

  async create(data: {
    companyId: string;
    email: string;
    platformRole?: string;
    departmentCode?: string;
    departmentRole?: string;
  }) {
    const email = data.email.trim().toLowerCase();
    if (!data.companyId) throw new BadRequestException('Authenticated company is required');
    if (!['EMPLOYEE', 'SYSTEM_ADMIN'].includes(data.platformRole || 'EMPLOYEE')) {
      throw new BadRequestException('Invalid platform role');
    }
    if (data.departmentRole && !['AGENT', 'MANAGER'].includes(data.departmentRole)) {
      throw new BadRequestException('Invalid department role');
    }
    const existing = await this.prisma.user.findFirst({ where: { companyId: data.companyId, email }, select: { id: true, active: true } });
    if (existing?.active) throw new ConflictException('A user with this email already exists in the company');
    if (data.departmentCode) {
      const department = await this.prisma.department.findFirst({ where: { companyId: data.companyId, code: data.departmentCode }, select: { id: true } });
      if (!department) throw new BadRequestException('Selected department was not found');
    }
    // Replace any stale invitation for this email so a deactivated user can be re-invited.
    await this.prisma.invitation.deleteMany({ where: { companyId: data.companyId, email } });
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await this.prisma.invitation.create({
      data: {
        companyId: data.companyId,
        email,
        platformRole: (data.platformRole as any) || 'EMPLOYEE',
        departmentCode: data.departmentCode,
        departmentRole: (data.departmentRole as any) || null,
        token,
        expiresAt,
      },
      include: { company: { select: { name: true } } },
    });

    this.logger.log(`Invitation created for ${email} to ${invitation.company.name}`);

    return {
      id: invitation.id,
      email: invitation.email,
      token: invitation.token,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }
}
