import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { TenantContext } from '../tenant-context';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = auth.slice(7);
    const user = await this.authService.verifyToken(token);
    req.user = user;

    // `run()` ends when the guard callback returns, before the controller is
    // invoked. `enterWith()` keeps the authenticated tenant in the request's
    // AsyncLocalStorage chain for every downstream service and Prisma query.
    TenantContext.enterWith({
      ...TenantContext.getStore(),
      companyId: user.companyId,
    });
    return true;
  }
}
