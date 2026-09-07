import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { ScopedPrismaService } from '../scoped-prisma.service';
import { DepartmentsService } from '../departments/departments.service';
import { AuthUser } from '../auth/auth.service';

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly prisma: ScopedPrismaService,
    private readonly departments: DepartmentsService,
  ) {}

  async listMyRequests(user: AuthUser) {
    return this.prisma.request.findMany({
      where: { employeeId: user.sub },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        documents: { where: { deletedAt: null }, select: { id: true, originalFilename: true, mimeType: true, byteSize: true, checksum: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listDeptQueue(user: AuthUser, departmentCode: string) {
    let departmentId: string | undefined;

    if (departmentCode && departmentCode !== '_all') {
      const dept = await this.prisma.department.findFirst({
        where: { code: departmentCode },
      });
      if (!dept) throw new NotFoundException(`Department ${departmentCode} not found`);
      departmentId = dept.id;
    }

    const where: any = { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } };
    if (departmentId) where.departmentId = departmentId;

    return this.prisma.request.findMany({
      where,
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        employee: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listClaimed(user: AuthUser) {
    return this.prisma.request.findMany({
      where: { claimedBy: user.sub, status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        employee: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRequest(id: string, user: AuthUser) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        employee: { select: { id: true, displayName: true, email: true } },
        documents: { where: { deletedAt: null }, select: { id: true, originalFilename: true, mimeType: true, byteSize: true, checksum: true, createdAt: true } },
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  async getStats(user: AuthUser) {
    const where = {};
    const [total, pending, inProgress, completed, rejected, cancelled] = await Promise.all([
      this.prisma.request.count({ where: { ...where, employeeId: user.sub } }),
      this.prisma.request.count({ where: { ...where, employeeId: user.sub, status: 'PENDING' } }),
      this.prisma.request.count({ where: { ...where, employeeId: user.sub, status: 'IN_PROGRESS' } }),
      this.prisma.request.count({ where: { ...where, employeeId: user.sub, status: 'COMPLETED' } }),
      this.prisma.request.count({ where: { ...where, employeeId: user.sub, status: 'REJECTED' } }),
      this.prisma.request.count({ where: { ...where, employeeId: user.sub, status: 'CANCELLED' } }),
    ]);
    return { total, pending, inProgress, completed, rejected, cancelled };
  }

  async createRequest(user: AuthUser, dto: { departmentCode: string; requestTypeCode: string; title: string; description?: string; priority?: string }) {
    const dept = await this.prisma.department.findFirst({
      where: { code: dto.departmentCode },
      include: { requestTypes: true },
    });
    if (!dept) throw new NotFoundException(`Department ${dto.departmentCode} not found`);

    const rt = dept.requestTypes.find((t) => t.code === dto.requestTypeCode);
    if (!rt) throw new NotFoundException(`Request type ${dto.requestTypeCode} not found in ${dto.departmentCode}`);

    const request = await this.prisma.request.create({
      data: {
        employeeId: user.sub,
        departmentId: dept.id,
        requestTypeId: rt.id,
        title: dto.title,
        description: dto.description || '',
        priority: (dto.priority as any) || rt.defaultPriority,
      },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        requestId: request.id,
        actorId: user.sub,
        action: 'REQUEST_CREATED',
        newValue: request.title,
      },
    });

    return request;
  }

  async claimRequest(id: string, user: AuthUser) {
    const request = await this.prisma.request.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.claimedBy) throw new ConflictException('Request is already claimed');
    if (request.status === 'COMPLETED' || request.status === 'CANCELLED' || request.status === 'REJECTED') {
      throw new BadRequestException('Cannot claim a closed request');
    }

    // Atomic compare-and-swap: guarantees exactly one concurrent claimant succeeds
    const claimResult = await this.prisma.request.updateMany({
      where: {
        id,
        claimedBy: null,
        status: 'PENDING',
      },
      data: {
        claimedBy: user.sub,
        status: 'IN_PROGRESS',
      },
    });

    if (claimResult.count === 0) {
      throw new ConflictException('Concurrent claim conflict: Another agent claimed this request');
    }

    await this.prisma.auditLog.create({
      data: {
        requestId: id,
        actorId: user.sub,
        action: 'REQUEST_CLAIMED',
        newValue: user.name || user.sub,
      },
    });

    return this.prisma.request.findUnique({
      where: { id },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        employee: { select: { id: true, displayName: true, email: true } },
      },
    });
  }

  async updateStatus(id: string, user: AuthUser, dto: { status: string; resolutionNote?: string; rejectionReason?: string }) {
    const request = await this.prisma.request.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');

    const data: any = { status: dto.status };
    if (dto.resolutionNote) data.resolutionNote = dto.resolutionNote;
    if (dto.rejectionReason) data.rejectionReason = dto.rejectionReason;
    if (dto.status === 'COMPLETED' || dto.status === 'REJECTED' || dto.status === 'CANCELLED') {
      data.completedAt = new Date();
    }

    const updated = await this.prisma.request.update({
      where: { id },
      data,
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
      },
    });

      await this.prisma.auditLog.create({
      data: {
        requestId: id,
        actorId: user.sub,
        action: `STATUS_${dto.status}`,
        oldValue: request.status,
        newValue: dto.status,
        metadata: dto.resolutionNote
          ? { resolutionNote: dto.resolutionNote }
          : dto.rejectionReason
            ? { rejectionReason: dto.rejectionReason }
            : undefined,
      },
    });

    return updated;
  }

  async cancelRequest(id: string, user: AuthUser) {
    const request = await this.prisma.request.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.employeeId !== user.sub) throw new BadRequestException('Only the employee can cancel');
    if (request.status === 'COMPLETED' || request.status === 'CANCELLED') {
      throw new BadRequestException('Cannot cancel a closed request');
    }

    const updated = await this.prisma.request.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        requestId: id,
        actorId: user.sub,
        action: 'REQUEST_CANCELLED',
        oldValue: request.status,
        newValue: 'CANCELLED',
      },
    });

    return updated;
  }
}
