import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import { TenantContext } from '../tenant-context';

/**
 * HTTP Interceptor that generates a unique X-Request-ID (UUID) for every
 * incoming request and propagates it via AsyncLocalStorage (TenantContext).
 *
 * Execution order in NestJS:
 *   Interceptor.intercept() → Guard.canActivate() → Handler
 *
 * The interceptor runs FIRST, creating the AsyncLocalStorage scope with
 * the requestId. The JwtGuard then runs inside that scope and merges the
 * companyId into the same store. This ensures every downstream service,
 * Prisma query, audit log entry, and error response has access to the
 * requestId without explicit parameter passing.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const requestId = (req.headers['x-request-id'] as string) || randomUUID();

    res.setHeader('X-Request-ID', requestId);

    const existing = TenantContext.getStore();

    return new Observable<unknown>((subscriber) => {
      TenantContext.run({ ...existing, requestId }, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
