import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

// Translates infrastructure failures (e.g. Postgres down) into a 503 so the
// mobile client can render a maintenance screen instead of a generic 500.
@Catch()
export class InfraExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(InfraExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return res.status(status).json({
        statusCode: status,
        message: exception.message,
      });
    }

    const message = exception instanceof Error ? exception.message : 'Internal server error';
    const isInfra =
      /prisma|connect|timeout|econnrefused|connection/i.test(message) ||
      (exception as any)?.code === 'P1001' ||
      (exception as any)?.code === 'P1008';

    const status = isInfra ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR;
    this.logger.error('Unhandled error', message);
    return res.status(status).json({ statusCode: status, message });
  }
}
