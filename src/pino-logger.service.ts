import { LoggerService, Injectable } from '@nestjs/common';
import pino from 'pino';
import { TenantContext } from './tenant-context';

/**
 * Pino-based LoggerService that replaces the default NestJS logger.
 *
 * Every log line is structured JSON with:
 * - level, time (ISO 8601), msg
 * - requestId (from AsyncLocalStorage TenantContext)
 * - context (the class name, set by NestJS)
 *
 * Usage in services remains identical:
 *   private readonly logger = new Logger(MyService.name);
 *   this.logger.log('something');
 *
 * But the output is now pino JSON instead of NestJS's console-based logger.
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino({
      level: process.env['LOG_LEVEL'] || 'info',
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'password',
          'passwordHash',
          'token',
          'secret',
        ],
        censor: '[REDACTED]',
      },
    });
  }

  private getRequestId(): string | undefined {
    return TenantContext.getStore()?.requestId;
  }

  log(message: string, ...optionalParams: unknown[]) {
    const [context, ...rest] = optionalParams;
    const base = {
      requestId: this.getRequestId(),
      context: typeof context === 'string' ? context : undefined,
    };
    const extra = typeof context === 'string' ? rest : optionalParams;
    this.logger.info({ ...base, extra }, message);
  }

  error(message: string, ...optionalParams: unknown[]) {
    const [trace, context] = optionalParams;
    this.logger.error(
      {
        requestId: this.getRequestId(),
        context: typeof context === 'string' ? context : undefined,
        trace: trace instanceof Error ? trace.stack : trace,
      },
      message,
    );
  }

  warn(message: string, ...optionalParams: unknown[]) {
    const [context, ...rest] = optionalParams;
    const base = {
      requestId: this.getRequestId(),
      context: typeof context === 'string' ? context : undefined,
    };
    const extra = typeof context === 'string' ? rest : optionalParams;
    this.logger.warn({ ...base, extra }, message);
  }

  debug(message: string, ...optionalParams: unknown[]) {
    const [context, ...rest] = optionalParams;
    const base = {
      requestId: this.getRequestId(),
      context: typeof context === 'string' ? context : undefined,
    };
    const extra = typeof context === 'string' ? rest : optionalParams;
    this.logger.debug({ ...base, extra }, message);
  }

  verbose(message: string, ...optionalParams: unknown[]) {
    const [context, ...rest] = optionalParams;
    const base = {
      requestId: this.getRequestId(),
      context: typeof context === 'string' ? context : undefined,
    };
    const extra = typeof context === 'string' ? rest : optionalParams;
    this.logger.trace({ ...base, extra }, message);
  }
}
