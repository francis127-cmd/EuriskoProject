import { Injectable, Logger } from '@nestjs/common';
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
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await this.prisma.invitation.create({
      data: {
        companyId: data.companyId,
        email: data.email,
        platformRole: (data.platformRole as any) || 'EMPLOYEE',
        departmentCode: data.departmentCode,
        departmentRole: (data.departmentRole as any) || null,
        token,
        expiresAt,
      },
      include: { company: { select: { name: true } } },
    });

    this.logger.log(`Invitation created for ${data.email} to ${invitation.company.name} (token: ${token})`);

    return {
      id: invitation.id,
      email: invitation.email,
      token: invitation.token,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }
}
