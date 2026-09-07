import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.service';

/**
 * Guard that ensures the authenticated user is a SYSTEM_ADMIN
 * within their company. Applied to admin-only routes.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user: AuthUser = req.user;
    if (!user || user.role !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
