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

    let user;
    try {
      user = await this.authService.verifyToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    req.user = user;

    // Mutate the existing store (created by TenantMiddleware via .run()).
    // Safe: no enterWith(), no context leak risk.
    const store = TenantContext.getStore();
    if (store) {
      store.companyId = user.companyId;
    }

    return true;
  }
}
