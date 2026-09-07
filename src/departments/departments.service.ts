import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ScopedPrismaService } from '../scoped-prisma.service';
import { AuthUser } from '../auth/auth.service';

@Injectable()
export class DepartmentsService {
  private readonly logger = new Logger(DepartmentsService.name);

  constructor(private readonly prisma: ScopedPrismaService) {}

  /**
   * List active departments in the authenticated user's company.
   * The ScopedPrismaService middleware auto-filters by companyId.
   */
  async listActive(user: AuthUser) {
    return this.prisma.department.findMany({
      where: { active: true },
      include: { requestTypes: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get a single department by companyId + code composite key.
   */
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

  /**
   * Assert the user is a member of the given department.
   */
  async assertMemberOf(user: AuthUser, departmentId: string) {
    const member = await this.prisma.departmentMember.findUnique({
      where: { departmentId_userId: { departmentId, userId: user.sub } },
    });
    if (!member && user.role !== 'SYSTEM_ADMIN') {
      throw new NotFoundException('You are not a member of this department');
    }
  }

  async getMemberships(user: AuthUser) {
    return this.prisma.departmentMember.findMany({
      where: { userId: user.sub },
      include: {
        department: {
          select: { id: true, code: true, name: true, description: true, active: true },
        },
      },
    });
  }
}
