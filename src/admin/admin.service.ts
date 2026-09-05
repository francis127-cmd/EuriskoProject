import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthUser } from '../auth/auth.service';
import { Prisma, DepartmentRole, PlatformRole } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async inviteUser(
    dto: { email: string; displayName: string; departmentCode?: string; departmentRole?: string },
    admin: AuthUser,
  ) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('User with this email already exists');

    const user = await this.prisma.user.create({
      data: {
        companyId: admin.companyId,
        ssoSubject: dto.email,
        email: dto.email,
        displayName: dto.displayName,
        platformRole: PlatformRole.EMPLOYEE,
      },
    });

    if (dto.departmentCode) {
      const dept = await this.prisma.department.findUnique({
        where: { companyId_code: { companyId: admin.companyId, code: dto.departmentCode } },
      });
      if (!dept) throw new NotFoundException(`Department ${dto.departmentCode} not found`);

      await this.prisma.departmentMember.create({
        data: {
          departmentId: dept.id,
          userId: user.id,
          departmentRole: (dto.departmentRole as DepartmentRole) || DepartmentRole.AGENT,
        },
      });
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      message: `Invite sent to ${user.email}. They can now sign in with Google.`,
    };
  }

  async listUsers(admin: AuthUser) {
    return this.prisma.user.findMany({
      where: { companyId: admin.companyId },
      include: {
        memberships: {
          include: { department: { select: { code: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateUser(
    userId: string,
    dto: { departmentCode?: string; departmentRole?: string; platformRole?: string },
    admin: AuthUser,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.companyId !== admin.companyId) {
      throw new NotFoundException('User not found');
    }

    if (dto.platformRole) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { platformRole: dto.platformRole as PlatformRole },
      });
    }

    if (dto.departmentCode) {
      const dept = await this.prisma.department.findUnique({
        where: { companyId_code: { companyId: admin.companyId, code: dto.departmentCode } },
      });
      if (!dept) throw new NotFoundException(`Department ${dto.departmentCode} not found`);

      await this.prisma.departmentMember.upsert({
        where: { departmentId_userId: { departmentId: dept.id, userId } },
        update: { departmentRole: (dto.departmentRole as DepartmentRole) || DepartmentRole.AGENT },
        create: {
          departmentId: dept.id,
          userId,
          departmentRole: (dto.departmentRole as DepartmentRole) || DepartmentRole.AGENT,
        },
      });
    }

    return { message: 'User updated' };
  }

  async deactivateUser(userId: string, admin: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.companyId !== admin.companyId) {
      throw new NotFoundException('User not found');
    }
    if (user.id === admin.sub) {
      throw new BadRequestException('Cannot deactivate yourself');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { active: false },
    });

    return { message: 'User deactivated' };
  }

  async listDepartments(admin: AuthUser) {
    return this.prisma.department.findMany({
      where: { companyId: admin.companyId, active: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
