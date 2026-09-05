import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { S3Service } from './s3.service';
import { DepartmentsService } from '../departments/departments.service';
import { AuthUser } from '../auth/auth.service';
import { createHash } from 'crypto';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);
const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly departments: DepartmentsService,
  ) {}

  private ext(name: string): string {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i).toLowerCase() : '';
  }

  async upload(
    requestId: string,
    file: { buffer: Buffer; originalname: string; mimetype?: string },
    user: AuthUser,
  ) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { department: { select: { companyId: true } } },
    });
    if (!request || request.department.companyId !== user.companyId) {
      throw new NotFoundException('Request not found');
    }

    // Must be claimed before documents can be uploaded
    if (!request.claimedBy) {
      throw new BadRequestException('Request must be claimed before uploading documents');
    }

    // Authorization: dept member or admin
    if (user.platformRole !== 'SYSTEM_ADMIN') {
      await this.departments.assertMemberOf(user, request.departmentId);
    }

    // Validate file
    const ext = this.ext(file.originalname);
    if (!ALLOWED_EXT.has(ext)) {
      throw new BadRequestException('Only .pdf, .png, .jpg, .jpeg are allowed');
    }
    if (file.buffer.byteLength > MAX_BYTES) {
      throw new BadRequestException('File exceeds 5MB limit');
    }
    if (file.mimetype && !ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Unsupported MIME type');
    }

    // Compute checksum
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `documents/${requestId}-${Date.now()}${ext}`;

    // Upload to S3
    await this.s3.upload(storageKey, file.buffer, file.mimetype || 'application/octet-stream');

    // Soft-delete any existing document for this request
    await this.prisma.document.updateMany({
      where: { requestId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          requestId,
          storageKey,
          originalFilename: file.originalname,
          mimeType: file.mimetype || 'application/octet-stream',
          byteSize: file.buffer.byteLength,
          checksum,
          uploadedBy: user.sub,
          purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });

      await tx.auditLog.create({
        data: {
          requestId,
          actorId: user.sub,
          action: 'DOCUMENT_UPLOADED',
          oldValue: null,
          newValue: storageKey,
          metadata: { filename: file.originalname, checksum, byteSize: file.buffer.byteLength },
        },
      });

      return created;
    });

    return {
      id: doc.id,
      filename: doc.originalFilename,
      mimeType: doc.mimeType,
      byteSize: doc.byteSize,
      checksum: doc.checksum,
      uploadedAt: doc.createdAt.toISOString(),
    };
  }

  async download(requestId: string, user: AuthUser) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { department: { select: { companyId: true } } },
    });
    if (!request || request.department.companyId !== user.companyId) {
      throw new NotFoundException('Request not found');
    }

    // Authorization: employee can download own, dept members can download dept, admin all
    if (user.platformRole !== 'SYSTEM_ADMIN') {
      if (request.employeeId !== user.sub) {
        await this.departments.assertMemberOf(user, request.departmentId);
      }
    }

    const doc = await this.prisma.document.findFirst({
      where: { requestId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('No document attached');

    const { body, contentType } = await this.s3.download(doc.storageKey);
    return {
      filename: doc.originalFilename,
      content: body,
      contentType,
      byteSize: doc.byteSize,
      checksum: doc.checksum,
    };
  }

  async remove(requestId: string, user: AuthUser) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { department: { select: { companyId: true } } },
    });
    if (!request || request.department.companyId !== user.companyId) {
      throw new NotFoundException('Request not found');
    }

    if (user.platformRole !== 'SYSTEM_ADMIN') {
      await this.departments.assertMemberOf(user, request.departmentId);
    }

    const doc = await this.prisma.document.findFirst({
      where: { requestId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('No document attached');

    // Delete from S3 first
    await this.s3.delete(doc.storageKey);

    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: doc.id },
        data: { deletedAt: new Date(), storageKey: `deleted/${doc.storageKey}` },
      });

      await tx.auditLog.create({
        data: {
          requestId,
          actorId: user.sub,
          action: 'DOCUMENT_DELETED',
          oldValue: doc.storageKey,
          newValue: null,
          metadata: { filename: doc.originalFilename },
        },
      });
    });

    return { deleted: true };
  }
}
