import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdminPrismaService } from '../admin-prisma.service';
import { S3Service } from '../documents/s3.service';

/**
 * Document retention service — operates across ALL companies.
 * Uses AdminPrismaService (no tenant scoping) because this is a
 * system-level cron job that must process documents from every tenant.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: AdminPrismaService,
    private readonly s3: S3Service,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeExpiredDocuments() {
    this.logger.log('Starting document purge job...');

    const expired = await this.prisma.document.findMany({
      where: { purgeAt: { lte: new Date() }, deletedAt: null },
    });

    this.logger.log(`Found ${expired.length} documents past retention period`);

    let successCount = 0;
    let failCount = 0;

    for (const doc of expired) {
      try {
        await this.s3.delete(doc.storageKey);
        await this.prisma.document.update({
          where: { id: doc.id },
          data: { deletedAt: new Date(), storageKey: `purged/${doc.storageKey}` },
        });
        await this.prisma.auditLog.create({
          data: {
            requestId: doc.requestId,
            actorId: 'system',
            action: 'DOCUMENT_PURGED',
            oldValue: doc.storageKey,
            metadata: { reason: 'retention_policy', byteSize: doc.byteSize },
          },
        });
        successCount++;
      } catch (e) {
        failCount++;
        this.logger.error(`Failed to purge document ${doc.id}: ${(e as Error).message}`);
      }
    }

    this.logger.log(`Purge complete: ${successCount} succeeded, ${failCount} failed`);
  }
}
