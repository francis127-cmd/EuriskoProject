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

/**
 * Catches all unhandled exceptions and translates infrastructure failures
 * (Postgres down, Prisma connection errors) into a 503 so the mobile client
 * can render a maintenance screen instead of a generic 500.
 *
 * Every response includes a `requestId` from AsyncLocalStorage, allowing
 * users to report the exact trace ID to IT when something breaks.
 */
@Catch()
export class InfraExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(InfraExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = TenantContext.getStore()?.requestId;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : (body as Record<string, unknown>).message || exception.message;
      return res.status(status).json({
        statusCode: status,
        message,
        requestId,
        timestamp: new Date().toISOString(),
        path: req.url,
      });
    }

    const message = exception instanceof Error ? exception.message : 'Internal server error';
    const stack = exception instanceof Error ? exception.stack : undefined;
    const isInfra =
      /prisma|connect|timeout|econnrefused|connection/i.test(message) ||
      (exception as any)?.code === 'P1001' ||
      (exception as any)?.code === 'P1008';

    const status = isInfra ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR;

    this.logger.error(`[${requestId}] Unhandled error on ${req.method} ${req.url}: ${message}`, stack);

    return res.status(status).json({
      statusCode: status,
      message: isInfra ? 'Service temporarily unavailable' : 'Internal server error',
      requestId,
      timestamp: new Date().toISOString(),
      path: req.url,
    });
  }
}
