import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PlatformRole, DepartmentRole } from '@prisma/client';
import { randomBytes } from 'crypto';

@Injectable()
export class InvitationService {
  constructor(private readonly prisma: PrismaService) {}

  async createInvitation(
    companyId: string, 
    email: string, 
    platformRole: PlatformRole = 'EMPLOYEE',
    departmentCode?: string,
    departmentRole?: DepartmentRole
  ) {
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new BadRequestException('User already exists');
    }

    await this.prisma.invitation.deleteMany({
      where: { companyId, email }
    });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const invitation = await this.prisma.invitation.create({
      data: {
        companyId,
        email,
        platformRole,
        departmentCode,
        departmentRole,
        token,
        expiresAt,
      }
    });

    console.log(`[Email Mock] Send invite to ${email} with deep link: hr-mobile://invite?token=${token}`);

    return invitation;
  }
}
