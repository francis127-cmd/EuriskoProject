import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ScopedPrismaService } from '../scoped-prisma.service';
import { S3Service } from './s3.service';
import { DepartmentsService } from '../departments/departments.service';
import { AuthUser } from '../auth/auth.service';
import { createHash } from 'crypto';

const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']);
const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const MAX_BYTES = 5 * 1024 * 1024;

const MAGIC_BYTES: Record<string, Buffer[]> = {
  'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'image/jpg': [Buffer.from([0xff, 0xd8, 0xff])],
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: ScopedPrismaService,
    private readonly s3: S3Service,
    private readonly departments: DepartmentsService,
  ) {}

  /**
   * S3/MinIO is used only when explicitly configured. Render has no object
   * storage attached, so uploads fall back to Postgres bytea (files are
   * capped at 5MB). This avoids a hard 500 when MINIO_* is unset.
   */
  private get useS3(): boolean {
    return !!process.env['MINIO_ENDPOINT'];
  }

  private async s3Upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    try {
      await this.s3.upload(key, buffer, contentType);
    } catch (e) {
      this.logger.error(`Document storage upload failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Document storage is temporarily unavailable. Please try again.');
    }
  }

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
    if (!request.claimedBy) {
      throw new BadRequestException('Request must be claimed before uploading documents');
    }
    if (user.role !== 'SYSTEM_ADMIN') {
      await this.departments.assertMemberOf(user, request.departmentId);
    }

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

    const expectedSignatures = MAGIC_BYTES[file.mimetype || ''];
    if (expectedSignatures && file.buffer.byteLength >= 4) {
      const fileHeader = file.buffer.subarray(0, 4);
      const validSignature = expectedSignatures.some((sig) => fileHeader.subarray(0, sig.length).equals(sig));
      if (!validSignature) {
        throw new BadRequestException('File content does not match its declared type');
      }
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = this.useS3
      ? `documents/${requestId}-${Date.now()}${ext}`
      : `db/${requestId}-${Date.now()}${ext}`;

    if (this.useS3) {
      await this.s3Upload(storageKey, file.buffer, file.mimetype || 'application/octet-stream');
    }

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
          data: this.useS3 ? undefined : file.buffer,
          uploadedBy: user.sub,
          purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await tx.auditLog.create({
        data: {
          requestId,
          actorId: user.sub,
          action: 'DOCUMENT_UPLOADED',
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
    if (user.role !== 'SYSTEM_ADMIN' && request.employeeId !== user.sub) {
      await this.departments.assertMemberOf(user, request.departmentId);
    }

    const doc = await this.prisma.document.findFirst({ where: { requestId, deletedAt: null } });
    if (!doc) throw new NotFoundException('No document attached');

    if (doc.data) {
      return {
        filename: doc.originalFilename,
        content: Buffer.from(doc.data),
        contentType: doc.mimeType,
        byteSize: doc.byteSize,
        checksum: doc.checksum,
      };
    }

    let downloaded: { body: Buffer; contentType: string };
    try {
      downloaded = await this.s3.download(doc.storageKey);
    } catch (e) {
      this.logger.error(`Document storage download failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Document storage is temporarily unavailable. Please try again.');
    }
    const { body, contentType } = downloaded;
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
    if (user.role !== 'SYSTEM_ADMIN') {
      await this.departments.assertMemberOf(user, request.departmentId);
    }

    const doc = await this.prisma.document.findFirst({ where: { requestId, deletedAt: null } });
    if (!doc) throw new NotFoundException('No document attached');

    if (!doc.data) {
      try {
        await this.s3.delete(doc.storageKey);
      } catch (e) {
        this.logger.warn(`Document storage delete failed (continuing with soft-delete): ${(e as Error).message}`);
      }
    }

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
          metadata: { filename: doc.originalFilename },
        },
      });
    });

    return { deleted: true };
  }
}
