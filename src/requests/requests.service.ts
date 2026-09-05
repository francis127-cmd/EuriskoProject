import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DepartmentsService } from '../departments/departments.service';
import { AuthUser } from '../auth/auth.service';
import { CreateRequestDto, UpdateRequestStatusDto } from './requests.types';
import { Prisma, RequestStatus } from '@prisma/client';

const VALID_TRANSITIONS: Record<string, RequestStatus[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED', 'REJECTED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED'],
};

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departments: DepartmentsService,
  ) {}

  async create(dto: CreateRequestDto, user: AuthUser) {
    if (user.platformRole === 'SYSTEM_ADMIN') {
      throw new ForbiddenException('Administrators cannot create requests');
    }

    const dept = await this.departments.getDepartment(user.companyId, dto.departmentCode);

    // Department staff cannot create requests to their OWN department
    const membership = await this.prisma.departmentMember.findUnique({
      where: { departmentId_userId: { departmentId: dept.id, userId: user.sub } },
    });
    if (membership && membership.active) {
      throw new ForbiddenException('Department staff cannot create requests to their own department');
    }
    const requestType = dept.requestTypes.find((rt) => rt.code === dto.requestTypeCode);
    if (!requestType) {
      throw new BadRequestException(`Request type ${dto.requestTypeCode} not found in department ${dto.departmentCode}`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.request.create({
        data: {
          employeeId: user.sub,
          departmentId: dept.id,
          requestTypeId: requestType.id,
          title: dto.title,
          description: dto.description || '',
          priority: (dto.priority || requestType.defaultPriority) as any,
          status: 'PENDING',
        },
        include: {
          department: { select: { code: true, name: true } },
          requestType: { select: { code: true, name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          requestId: request.id,
          actorId: user.sub,
          action: 'CREATED',
          oldValue: null,
          newValue: 'PENDING',
          metadata: { departmentCode: dept.code, requestTypeCode: requestType.code },
        },
      });

      await tx.notificationEvent.create({
        data: {
          requestId: request.id,
          eventType: 'REQUEST_CREATED',
          payload: { title: request.title, department: dept.code },
        },
      });

      return request;
    });

    return result;
  }

  async listEmployee(user: AuthUser) {
    return this.prisma.request.findMany({
      where: { employeeId: user.sub },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        documents: { where: { deletedAt: null }, select: { id: true, originalFilename: true, createdAt: true } },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async listDepartmentQueue(user: AuthUser, departmentCode: string) {
    const dept = await this.departments.getDepartment(user.companyId, departmentCode);
    await this.departments.assertMemberOf(user, dept.id);

    return this.prisma.request.findMany({
      where: { departmentId: dept.id, status: { not: 'CANCELLED' } },
      include: {
        employee: { select: { id: true, displayName: true, email: true } },
        requestType: { select: { code: true, name: true } },
        documents: { where: { deletedAt: null }, select: { id: true, originalFilename: true } },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async listClaimed(user: AuthUser) {
    return this.prisma.request.findMany({
      where: { claimedBy: user.sub, status: { in: ['IN_PROGRESS', 'COMPLETED'] } },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        employee: { select: { id: true, displayName: true, email: true } },
        documents: { where: { deletedAt: null }, select: { id: true, originalFilename: true } },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getOne(id: string, user: AuthUser) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: {
        department: { select: { code: true, name: true } },
        requestType: { select: { code: true, name: true } },
        employee: { select: { id: true, displayName: true, email: true } },
        documents: { where: { deletedAt: null } },
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!request) throw new NotFoundException('Request not found');

    // Authorization: employee can only see own requests, dept members can see dept requests, admin sees all
    if (user.platformRole !== 'SYSTEM_ADMIN') {
      if (request.employeeId === user.sub) {
        // Employee — own request, allowed
      } else {
        // Must be department member
        await this.departments.assertMemberOf(user, request.departmentId);
      }
    }

    return request;
  }

  async claim(id: string, user: AuthUser) {
    const request = await this.prisma.request.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'PENDING') throw new BadRequestException('Only PENDING requests can be claimed');
    if (request.claimedBy) throw new ConflictException('Request already claimed');

    await this.departments.assertMemberOf(user, request.departmentId);

    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: conditional update
      const updated = await tx.request.updateMany({
        where: { id, status: 'PENDING', claimedBy: null },
        data: { status: 'IN_PROGRESS', claimedBy: user.sub },
      });
      if (updated.count === 0) throw new ConflictException('Request was claimed by another agent');

      const full = await tx.request.findUnique({ where: { id } });

      await tx.auditLog.create({
        data: {
          requestId: id,
          actorId: user.sub,
          action: 'CLAIMED',
          oldValue: 'PENDING',
          newValue: 'IN_PROGRESS',
        },
      });

      await tx.notificationEvent.create({
        data: {
          requestId: id,
          eventType: 'REQUEST_CLAIMED',
          payload: { claimedBy: user.displayName || user.sub },
        },
      });

      return full;
    });

    return result;
  }

  async updateStatus(id: string, dto: UpdateRequestStatusDto, user: AuthUser) {
    const request = await this.prisma.request.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');

    // Authorization
    if (user.platformRole !== 'SYSTEM_ADMIN') {
      await this.departments.assertMemberOf(user, request.departmentId);
    }

    // Validate transition
    const allowed = VALID_TRANSITIONS[request.status];
    if (!allowed || !allowed.includes(dto.status as RequestStatus)) {
      throw new BadRequestException(`Cannot transition from ${request.status} to ${dto.status}`);
    }

    // Resolution validation: COMPLETED requires note or document
    if (dto.status === 'COMPLETED') {
      const hasDoc = await this.prisma.document.findFirst({
        where: { requestId: id, deletedAt: null },
      });
      if (!dto.resolutionNote && !hasDoc) {
        throw new BadRequestException('Completion requires a resolution note or a document');
      }
    }

    // Rejection requires reason
    if (dto.status === 'REJECTED' && !dto.rejectionReason) {
      throw new BadRequestException('Rejection requires a reason');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.request.update({
        where: { id },
        data: {
          status: dto.status as any,
          resolutionNote: dto.resolutionNote || undefined,
          rejectionReason: dto.rejectionReason || undefined,
          completedAt: dto.status === 'COMPLETED' ? new Date() : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          requestId: id,
          actorId: user.sub,
          action: `STATUS_${dto.status}`,
          oldValue: request.status,
          newValue: dto.status,
          metadata: { resolutionNote: dto.resolutionNote, rejectionReason: dto.rejectionReason },
        },
      });

      await tx.notificationEvent.create({
        data: {
          requestId: id,
          eventType: `REQUEST_${dto.status}`,
          payload: { updatedBy: user.displayName || user.sub },
        },
      });

      return updated;
    });

    return result;
  }

  async cancel(id: string, user: AuthUser) {
    const request = await this.prisma.request.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.employeeId !== user.sub) throw new ForbiddenException('You can only cancel your own requests');
    if (request.status !== 'PENDING') throw new BadRequestException('Only PENDING requests can be cancelled');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.request.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      await tx.auditLog.create({
        data: {
          requestId: id,
          actorId: user.sub,
          action: 'STATUS_CANCELLED',
          oldValue: 'PENDING',
          newValue: 'CANCELLED',
        },
      });

      return updated;
    });
  }

  async getStats(user: AuthUser) {
    const isDeptStaff = await this.prisma.departmentMember.findFirst({
      where: { userId: user.sub, active: true },
    });

    const where = user.platformRole === 'SYSTEM_ADMIN'
      ? {}
      : isDeptStaff
        ? { department: { members: { some: { userId: user.sub, active: true } } } }
        : { employeeId: user.sub };

    const [total, pending, inProgress, completed, rejected, cancelled] = await Promise.all([
      this.prisma.request.count({ where }),
      this.prisma.request.count({ where: { ...where, status: 'PENDING' } }),
      this.prisma.request.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      this.prisma.request.count({ where: { ...where, status: 'COMPLETED' } }),
      this.prisma.request.count({ where: { ...where, status: 'REJECTED' } }),
      this.prisma.request.count({ where: { ...where, status: 'CANCELLED' } }),
    ]);

    return { total, pending, inProgress, completed, rejected, cancelled };
  }
}
