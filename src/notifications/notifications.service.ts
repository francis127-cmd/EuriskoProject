import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdminPrismaService } from '../admin-prisma.service';

const MAX_ATTEMPTS = 5;

/**
 * Durable notification outbox (product-spec section 6/8, architecture section 3).
 *
 * Events are written inside the same transaction as the request mutation,
 * so a committed change always has a corresponding event. Delivery is
 * asynchronous and never blocks the core write. Without a configured
 * delivery provider (NOTIFY_WEBHOOK_URL) events stay PENDING and visible —
 * they are never silently dropped.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: AdminPrismaService) {}

  /** Write an event inside an existing Prisma transaction (tx: any). */
  async emit(
    tx: any,
    data: { requestId?: string | null; eventType: string; payload: Record<string, unknown>; idempotencyKey: string },
  ): Promise<void> {
    await tx.notificationEvent.upsert({
      where: { idempotencyKey: data.idempotencyKey },
      update: {},
      create: {
        requestId: data.requestId || null,
        eventType: data.eventType,
        payload: data.payload as any,
        status: 'PENDING',
        idempotencyKey: data.idempotencyKey,
      },
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async deliverPendingEvents() {
    const webhook = process.env['NOTIFY_WEBHOOK_URL'];
    const pending = await this.prisma.notificationEvent.findMany({
      where: { status: 'PENDING', attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    if (pending.length === 0) return;

    if (!webhook) {
      this.logger.warn(
        `Notification delivery deferred: ${pending.length} event(s) pending, NOTIFY_WEBHOOK_URL not configured`,
      );
      return;
    }

    for (const event of pending) {
      try {
        const res = await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': event.idempotencyKey },
          body: JSON.stringify({
            id: event.id,
            type: event.eventType,
            requestId: event.requestId,
            payload: event.payload,
            createdAt: event.createdAt,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`webhook responded ${res.status}`);
        await this.prisma.notificationEvent.update({
          where: { id: event.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
      } catch (e) {
        const attempts = event.attempts + 1;
        await this.prisma.notificationEvent.update({
          where: { id: event.id },
          data: {
            attempts,
            lastError: (e as Error).message?.slice(0, 500),
            ...(attempts >= MAX_ATTEMPTS ? { status: 'FAILED' } : {}),
          },
        });
        this.logger.error(`Notification ${event.id} delivery failed (attempt ${attempts}): ${(e as Error).message}`);
      }
    }
  }
}
