import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { AdminPrismaService } from '../admin-prisma.service';

@Injectable()
export class ScimGroupService {
  private readonly logger = new Logger(ScimGroupService.name);

  constructor(private readonly prisma: AdminPrismaService) {}

  async listGroups(companyId: string) {
    const departments = await this.prisma.department.findMany({
      where: { companyId },
      include: {
        members: {
          include: {
            user: { select: { id: true, email: true, displayName: true } },
          },
        },
        requestTypes: true,
      },
    });

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: departments.length,
      startIndex: 1,
      itemsPerPage: departments.length,
      Resources: departments.map((d) => this.toScimGroup(d)),
    };
  }

  async getGroup(id: string, companyId: string) {
    const dept = await this.prisma.department.findFirst({
      where: { id, companyId },
      include: {
        members: {
          include: {
            user: { select: { id: true, email: true, displayName: true } },
          },
        },
        requestTypes: true,
      },
    });
    if (!dept) return null;
    return this.toScimGroup(dept);
  }

  async createGroup(data: { displayName: string; description?: string; externalId?: string }, companyId: string) {
    const code = data.displayName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const existing = await this.prisma.department.findFirst({
      where: { companyId, code },
    });
    if (existing) throw new BadRequestException('Group with this name already exists');

    const dept = await this.prisma.department.create({
      data: {
        companyId,
        code,
        name: data.displayName,
        description: data.description || null,
      },
    });

    this.logger.log(`SCIM group created: ${dept.name} for company ${companyId}`);
    return this.toScimGroup({ ...dept, members: [], requestTypes: [] });
  }

  async updateGroup(id: string, data: { displayName?: string; members?: { value: string; operation: string }[] }, companyId: string) {
    const dept = await this.prisma.department.findFirst({
      where: { id, companyId },
    });
    if (!dept) return null;

    const updateData: any = {};
    if (data.displayName) {
      updateData.name = data.displayName;
      updateData.code = data.displayName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    }

    await this.prisma.department.update({ where: { id }, data: updateData });

    if (data.members) {
      for (const member of data.members) {
        if (member.operation === 'add' || !member.operation) {
          const user = await this.prisma.user.findFirst({
            where: { id: member.value, companyId },
          });
          if (user) {
            await this.prisma.departmentMember.upsert({
              where: { departmentId_userId: { departmentId: id, userId: member.value } },
              create: { departmentId: id, userId: member.value, departmentRole: 'AGENT' },
              update: {},
            });
          }
        } else if (member.operation === 'remove') {
          await this.prisma.departmentMember.deleteMany({
            where: { departmentId: id, userId: member.value },
          });
        }
      }
    }

    return this.getGroup(id, companyId);
  }

  async deleteGroup(id: string, companyId: string): Promise<void> {
    const dept = await this.prisma.department.findFirst({
      where: { id, companyId },
      include: { requests: { where: { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } } } },
    });
    if (!dept) throw new NotFoundException('Group not found');
    if (dept.requests.length > 0) throw new BadRequestException('Cannot delete group with active requests');

    await this.prisma.departmentMember.deleteMany({ where: { departmentId: id } });
    await this.prisma.requestType.deleteMany({ where: { departmentId: id } });
    await this.prisma.department.delete({ where: { id } });
  }

  private toScimGroup(dept: any) {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      id: dept.id,
      externalId: dept.code,
      displayName: dept.name,
      description: dept.description || '',
      members: (dept.members || []).map((m: any) => ({
        $ref: `/Users/${m.user.id}`,
        value: m.user.id,
        display: m.user.displayName,
        type: 'User',
      })),
      meta: {
        resourceType: 'Group',
      },
    };
  }
}
