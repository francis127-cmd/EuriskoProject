import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { ScopedPrismaService } from '../scoped-prisma.service';
import { DepartmentsService } from '../departments/departments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/auth.service';

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED', 'REJECTED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED'],
};

// Postgres native enums sort by declaration order (LOW, STANDARD, URGENT),
// so URGENT-first queue ordering (acceptance criterion 10) requires DESC.
const QUEUE_ORDER = [{ priority: 'desc' as const }, { createdAt: 'asc' as const }];

const AGENT_SELECT = { agent: { select: { id: true, displayName: true, email: true } } };

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly prisma: ScopedPrismaService,
    private readonly departments: DepartmentsService,
    private readonly notifications: NotificationsService,
  ) {}

  async listMyRequests(user: AuthUser) {
    return this.prisma.request.findMany({
      where: { employeeId: user.sub },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        ...AGENT_SELECT,
        documents: { where: { deletedAt: null }, select: { id: true, originalFilename: true, mimeType: true, byteSize: true, checksum: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listDeptQueue(user: AuthUser, departmentCode: string) {
    let departmentId: string | undefined;

    if (departmentCode && departmentCode !== '_all') {
      const dept = await this.prisma.department.findUnique({
        where: { companyId_code: { companyId: user.companyId, code: departmentCode } },
      });
      if (!dept) throw new NotFoundException(`Department ${departmentCode} not found`);

      const isMember = await this.departments.isMemberOf(user, dept.id);
      if (!isMember) {
        throw new ForbiddenException('You are not a member of this department');
      }
      departmentId = dept.id;
    } else {
      if (user.role !== 'SYSTEM_ADMIN') {
        const memberships = await this.departments.getMemberships(user);
        const deptIds = memberships.map((m) => m.departmentId);
        if (deptIds.length === 0) return [];
        return this.prisma.request.findMany({
          where: { departmentId: { in: deptIds }, status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } },
          include: {
            department: { select: { code: true, name: true } },
            requestType: { select: { code: true, name: true } },
            employee: { select: { id: true, displayName: true, email: true } },
            ...AGENT_SELECT,
          },
          orderBy: QUEUE_ORDER,
        });
      }
    }

    const where: any = { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } };
    if (departmentId) where.departmentId = departmentId;

    return this.prisma.request.findMany({
      where,
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        employee: { select: { id: true, displayName: true, email: true } },
        ...AGENT_SELECT,
      },
      orderBy: QUEUE_ORDER,
    });
  }

  async listClaimed(user: AuthUser) {
    return this.prisma.request.findMany({
      where: { claimedBy: user.sub, status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        employee: { select: { id: true, displayName: true, email: true } },
        ...AGENT_SELECT,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRequest(id: string, user: AuthUser) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, code: true, name: true, companyId: true } },
        requestType: { select: { code: true, name: true } },
        employee: { select: { id: true, displayName: true, email: true } },
        ...AGENT_SELECT,
        documents: { where: { deletedAt: null }, select: { id: true, originalFilename: true, mimeType: true, byteSize: true, checksum: true, createdAt: true } },
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!request) throw new NotFoundException('Request not found');

    if (request.department.companyId !== user.companyId) {
      throw new NotFoundException('Request not found');
    }

    if (user.role === 'SYSTEM_ADMIN') {
      return request;
    }

    if (request.employeeId === user.sub) {
      return request;
    }

    const isMember = await this.departments.isMemberOf(user, request.departmentId);
    if (!isMember) {
      throw new ForbiddenException('You do not have access to this request');
    }

    return request;
  }

  async getStats(user: AuthUser) {
    const [total, pending, inProgress, completed, rejected, cancelled] = await Promise.all([
      this.prisma.request.count({ where: { employeeId: user.sub } }),
      this.prisma.request.count({ where: { employeeId: user.sub, status: 'PENDING' } }),
      this.prisma.request.count({ where: { employeeId: user.sub, status: 'IN_PROGRESS' } }),
      this.prisma.request.count({ where: { employeeId: user.sub, status: 'COMPLETED' } }),
      this.prisma.request.count({ where: { employeeId: user.sub, status: 'REJECTED' } }),
      this.prisma.request.count({ where: { employeeId: user.sub, status: 'CANCELLED' } }),
    ]);
    return { total, pending, inProgress, completed, rejected, cancelled };
  }

  async createRequest(user: AuthUser, dto: { departmentCode: string; requestTypeCode: string; title: string; description?: string; priority?: string }) {
    const dept = await this.prisma.department.findFirst({
      where: { code: dto.departmentCode, companyId: user.companyId },
      include: { requestTypes: { where: { active: true } } },
    });
    if (!dept) throw new NotFoundException(`Department ${dto.departmentCode} not found`);

    const rt = dept.requestTypes.find((t) => t.code === dto.requestTypeCode);
    if (!rt) throw new NotFoundException(`Request type ${dto.requestTypeCode} not found or inactive in ${dto.departmentCode}`);

    const request = await this.prisma.$transaction(async (tx) => {
      const req = await tx.request.create({
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

      await tx.auditLog.create({
        data: {
          requestId: req.id,
          actorId: user.sub,
          action: 'REQUEST_CREATED',
          newValue: req.title,
        },
      });

      await this.notifications.emit(tx, {
        requestId: req.id,
        eventType: 'request.created',
        payload: { departmentId: dept.id, requestTypeId: rt.id, priority: req.priority, title: req.title },
        idempotencyKey: `req-${req.id}-created`,
      });

      return req;
    });

    return request;
  }

  async claimRequest(id: string, user: AuthUser) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: { department: { select: { id: true } } },
    });
    if (!request) throw new NotFoundException('Request not found');

    const isMember = await this.departments.isMemberOf(user, request.departmentId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this department');
    }

    if (request.claimedBy) throw new ConflictException('Request is already claimed');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING requests can be claimed');
    }

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

    await this.prisma.notificationEvent.create({
      data: {
        requestId: id,
        eventType: 'request.claimed',
        payload: { claimedBy: user.sub } as any,
        status: 'PENDING',
        idempotencyKey: `req-${id}-claimed-${user.sub}`,
      },
    });

    return this.prisma.request.findUnique({
      where: { id },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        employee: { select: { id: true, displayName: true, email: true } },
        ...AGENT_SELECT,
      },
    });
  }

  async updateStatus(id: string, user: AuthUser, dto: { status: string; resolutionNote?: string; rejectionReason?: string }) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: { department: { select: { id: true } } },
    });
    if (!request) throw new NotFoundException('Request not found');

    const isMember = await this.departments.isMemberOf(user, request.departmentId);
    if (!isMember && user.role !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException('You are not authorized to update this request');
    }

    const validNext = VALID_TRANSITIONS[request.status];
    if (!validNext || !validNext.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid transition: ${request.status} -> ${dto.status}. Allowed: ${validNext?.join(', ') || 'none'}`,
      );
    }

    if (dto.status === 'COMPLETED') {
      const hasResolution = dto.resolutionNote && dto.resolutionNote.trim().length > 0;
      if (!hasResolution) {
        const docCount = await this.prisma.document.count({
          where: { requestId: id, deletedAt: null },
        });
        if (docCount === 0) {
          throw new BadRequestException('Completion requires a non-empty resolution note or at least one attached document');
        }
      }
    }

    if (dto.status === 'REJECTED') {
      if (!dto.rejectionReason || dto.rejectionReason.trim().length === 0) {
        throw new BadRequestException('Rejection requires a reason');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const data: any = { status: dto.status };
      if (dto.resolutionNote) data.resolutionNote = dto.resolutionNote;
      if (dto.rejectionReason) data.rejectionReason = dto.rejectionReason;
      if (dto.status === 'COMPLETED' || dto.status === 'REJECTED' || dto.status === 'CANCELLED') {
        data.completedAt = new Date();
      }

      // Guard the state precondition inside the transaction: a concurrent
      // transition racing us updates zero rows instead of clobbering state.
      const guarded = await tx.request.updateMany({
        where: { id, status: request.status },
        data,
      });
      if (guarded.count === 0) {
        throw new ConflictException('Request changed concurrently, please reload and retry');
      }

      const updated = await tx.request.findUnique({
        where: { id },
        include: {
          department: { select: { code: true, name: true } },
          requestType: { select: { code: true, name: true } },
          ...AGENT_SELECT,
        },
      });

      await tx.auditLog.create({
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

      await this.notifications.emit(tx, {
        requestId: id,
        eventType: `request.${dto.status.toLowerCase()}`,
        payload: { from: request.status, to: dto.status, actorId: user.sub },
        idempotencyKey: `req-${id}-${dto.status}-${request.status}`,
      });

      return updated;
    });
  }

  async cancelRequest(id: string, user: AuthUser) {
    const request = await this.prisma.request.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.employeeId !== user.sub) throw new ForbiddenException('Only the employee can cancel');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING requests can be cancelled');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.request.update({
        where: { id },
        data: { status: 'CANCELLED', completedAt: new Date() },
        include: {
          department: { select: { code: true, name: true } },
          requestType: { select: { code: true, name: true } },
          ...AGENT_SELECT,
        },
      });

      await tx.auditLog.create({
        data: {
          requestId: id,
          actorId: user.sub,
          action: 'REQUEST_CANCELLED',
          oldValue: request.status,
          newValue: 'CANCELLED',
        },
      });

      await this.notifications.emit(tx, {
        requestId: id,
        eventType: 'request.cancelled',
        payload: { actorId: user.sub },
        idempotencyKey: `req-${id}-cancelled`,
      });

      return updated;
    });
  }
}
