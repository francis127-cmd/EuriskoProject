import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';

export interface AuthUser {
  sub: string;
  platformRole: string;
  displayName: string;
  email: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async validateSsoToken(ssoSubject: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { ssoSubject },
      select: { id: true, platformRole: true, displayName: true, email: true, active: true },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('Unknown or inactive user');
    }
    return {
      sub: user.id,
      platformRole: user.platformRole,
      displayName: user.displayName,
      email: user.email,
    };
  }

  async issueToken(ssoSubject: string): Promise<{ accessToken: string }> {
    const user = await this.validateSsoToken(ssoSubject);
    const payload = { sub: user.sub, role: user.platformRole, name: user.displayName, email: user.email };
    return { accessToken: this.jwt.sign(payload) };
  }

  async verifyToken(token: string): Promise<AuthUser> {
    try {
      const payload = this.jwt.verify<{ sub: string; role: string; name: string; email: string }>(token);
      return { sub: payload.sub, platformRole: payload.role, displayName: payload.name, email: payload.email };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
