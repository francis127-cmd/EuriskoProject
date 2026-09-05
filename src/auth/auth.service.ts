import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { OAuth2Client } from 'google-auth-library';

export interface AuthUser {
  sub: string;
  companyId: string;
  platformRole: string;
  displayName: string;
  email: string;
}

const googleClient = new OAuth2Client();

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async validateSsoToken(ssoSubject: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { ssoSubject },
      select: { id: true, companyId: true, platformRole: true, displayName: true, email: true, active: true },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('Unknown or inactive user');
    }
    return {
      sub: user.id,
      companyId: user.companyId,
      platformRole: user.platformRole,
      displayName: user.displayName,
      email: user.email,
    };
  }

  async issueToken(ssoSubject: string): Promise<{ accessToken: string }> {
    const user = await this.validateSsoToken(ssoSubject);
    const payload = { sub: user.sub, companyId: user.companyId, role: user.platformRole, name: user.displayName, email: user.email };
    return { accessToken: this.jwt.sign(payload) };
  }

  async validateGoogleToken(idToken: string): Promise<AuthUser> {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new UnauthorizedException('Invalid Google token');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: payload.email },
      select: { id: true, companyId: true, platformRole: true, displayName: true, email: true, active: true },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException(`No account found for ${payload.email}. Contact your administrator.`);
    }

    return {
      sub: user.id,
      companyId: user.companyId,
      platformRole: user.platformRole,
      displayName: user.displayName,
      email: user.email,
    };
  }

  async issueGoogleToken(idToken: string): Promise<{ accessToken: string }> {
    const user = await this.validateGoogleToken(idToken);
    const payload = { sub: user.sub, companyId: user.companyId, role: user.platformRole, name: user.displayName, email: user.email };
    return { accessToken: this.jwt.sign(payload) };
  }

  async verifyToken(token: string): Promise<AuthUser> {
    try {
      const payload = this.jwt.verify<{ sub: string; companyId: string; role: string; name: string; email: string }>(token);
      return { sub: payload.sub, companyId: payload.companyId, platformRole: payload.role, displayName: payload.name, email: payload.email };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
