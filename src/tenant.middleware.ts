import { Injectable, NestMiddleware } from '@nestjs/common';
import { TenantContext } from './tenant-context';

/**
 * Global middleware that creates an AsyncLocalStorage boundary for every
 * incoming HTTP request. This replaces the dangerous `enterWith()` pattern
 * in JwtGuard with a safe `.run()` scope that auto-cleans when the
 * request lifecycle ends.
 *
 * Execution order: Middleware → Interceptor → Guard → Controller
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: () => void) {
    TenantContext.run({ companyId: undefined, requestId: undefined }, () => {
      next();
    });
  }
}
