import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthUser } from '../auth/auth.service';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(companyId: string) {
    return this.prisma.department.findMany({
      where: { companyId, active: true },
      include: { requestTypes: { where: { active: true }, orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async getDepartment(companyId: string, code: string) {
    const dept = await this.prisma.department.findUnique({
      where: { companyId_code: { companyId, code } },
      include: { requestTypes: { where: { active: true }, orderBy: { name: 'asc' } } },
    });
    if (!dept) throw new NotFoundException(`Department ${code} not found`);
    return dept;
  }

  async getMemberships(userId: string) {
    return this.prisma.departmentMember.findMany({
      where: { userId, active: true },
      include: { department: true },
    });
  }

  async assertMemberOf(user: AuthUser, departmentId: string) {
    const membership = await this.prisma.departmentMember.findUnique({
      where: { departmentId_userId: { departmentId, userId: user.sub } },
    });
    if (!membership || !membership.active) {
      throw new ForbiddenException('You are not a member of this department');
    }
    return membership;
  }

  async assertManager(user: AuthUser, departmentId: string) {
    const membership = await this.assertMemberOf(user, departmentId);
    if (membership.departmentRole !== 'MANAGER') {
      throw new ForbiddenException('Manager role required');
    }
    return membership;
  }

  async assertAdminOrDeptMember(user: AuthUser, departmentId: string) {
    if (user.platformRole === 'SYSTEM_ADMIN') return null;
    return this.assertMemberOf(user, departmentId);
  }
}
