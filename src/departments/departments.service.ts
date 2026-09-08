import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ScopedPrismaService } from '../scoped-prisma.service';
import { AuthUser } from '../auth/auth.service';

@Injectable()
export class DepartmentsService {
  private readonly logger = new Logger(DepartmentsService.name);

  constructor(private readonly prisma: ScopedPrismaService) {}

  async listActive(user: AuthUser) {
    return this.prisma.department.findMany({
      where: { active: true },
      include: { requestTypes: { where: { active: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async getDepartment(companyId: string, code: string) {
    const dept = await this.prisma.department.findUnique({
      where: { companyId_code: { companyId, code } },
      include: { requestTypes: true },
    });
    if (!dept) {
      throw new NotFoundException(`Department ${code} not found`);
    }
    return dept;
  }

  async assertMemberOf(user: AuthUser, departmentId: string) {
    const member = await this.prisma.departmentMember.findFirst({
      where: {
        departmentId,
        userId: user.sub,
        active: true,
      },
    });
    if (!member && user.role !== 'SYSTEM_ADMIN') {
      throw new NotFoundException('You are not an active member of this department');
    }
  }

  async isMemberOf(user: AuthUser, departmentId: string): Promise<boolean> {
    if (user.role === 'SYSTEM_ADMIN') return true;
    const member = await this.prisma.departmentMember.findFirst({
      where: {
        departmentId,
        userId: user.sub,
        active: true,
      },
    });
    return !!member;
  }

  async isManagerOf(user: AuthUser, departmentId: string): Promise<boolean> {
    if (user.role === 'SYSTEM_ADMIN') return true;
    const member = await this.prisma.departmentMember.findFirst({
      where: {
        departmentId,
        userId: user.sub,
        departmentRole: 'MANAGER',
        active: true,
      },
    });
    return !!member;
  }

  async getMemberships(user: AuthUser) {
    return this.prisma.departmentMember.findMany({
      where: { userId: user.sub, active: true },
      include: {
        department: {
          select: { id: true, code: true, name: true, description: true, active: true },
        },
      },
    });
  }
}
