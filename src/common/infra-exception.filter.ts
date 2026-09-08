import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TenantContext } from '../tenant-context';
import { randomUUID } from 'crypto';

/**
 * Enterprise Infrastructure Exception Filter
 *
 * Guarantees that:
 * 1. ZERO internal database stack traces, SQL strings, or Prisma error codes (P1xxx/P2xxx)
 *    ever leak to the mobile client.
 * 2. All 500 and 503 errors return sanitized, user-safe messages.
 * 3. Every single error response carries a deterministic `requestId` for audit and tracing.
 */
@Catch()
export class InfraExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(InfraExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId =
      TenantContext.getStore()?.requestId ||
      (req.headers['x-request-id'] as string) ||
      randomUUID();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let message =
        typeof body === 'string'
          ? body
          : (body as Record<string, unknown>).message || exception.message;

      // Sanitize 5xx HttpExceptions
      if (status >= 500) {
        this.logger.error(
          `[${requestId}] Internal HttpException ${status} on ${req.method} ${req.url}: ${JSON.stringify(message)}`,
          exception.stack,
        );
        message =
          status === HttpStatus.SERVICE_UNAVAILABLE
            ? 'Service temporarily unavailable. Please try again shortly.'
            : 'An internal server error occurred.';
      }

      return res.status(status).json({
        statusCode: status,
        message,
        requestId,
        timestamp: new Date().toISOString(),
        path: req.url,
      });
    }

    const rawMessage = exception instanceof Error ? exception.message : 'Internal server error';
    const stack = exception instanceof Error ? exception.stack : undefined;
    const isInfra =
      /prisma|connect|timeout|econnrefused|connection|postgresql|database/i.test(rawMessage) ||
      (exception as any)?.code?.toString().startsWith('P1') ||
      (exception as any)?.code?.toString().startsWith('P2');

    const status = isInfra ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR;

    // Secure server-side audit logging
    this.logger.error(`[${requestId}] Unhandled error on ${req.method} ${req.url}: ${rawMessage}`, stack);

    // Sanitized client payload - zero leakage
    return res.status(status).json({
      statusCode: status,
      message: isInfra
        ? 'Service temporarily unavailable. Please try again shortly.'
        : 'An internal server error occurred.',
      requestId,
      timestamp: new Date().toISOString(),
      path: req.url,
    });
  }
}
