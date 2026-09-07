import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService, AuthUser } from './auth.service';
import { TenantContext } from '../tenant-context';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');
    const token = auth.slice(7);
    const user = await this.authService.verifyToken(token);
    req.user = user;

    const existing = TenantContext.getStore();
    return new Promise<boolean>((resolve) => {
      TenantContext.run({ ...existing, companyId: user.companyId }, () => {
        resolve(true);
      });
    });
  }
}
