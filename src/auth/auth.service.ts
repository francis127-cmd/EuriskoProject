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

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async validateSsoToken(ssoSubject: string): Promise<AuthUser> {
    const user = await this.prisma.user.findFirst({
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
    if (!payload || !payload.email || !payload.sub) {
      throw new UnauthorizedException('Invalid Google token');
    }

    let user = await this.prisma.user.findFirst({
      where: { email: payload.email },
      select: { id: true, companyId: true, platformRole: true, displayName: true, email: true, active: true },
    });

    if (!user) {
      const invite = await this.prisma.invitation.findFirst({
        where: { email: payload.email, expiresAt: { gt: new Date() } }
      });

      if (!invite) {
        throw new UnauthorizedException(`No account or pending invitation found for ${payload.email}. Contact your administrator.`);
      }

      const newUser = await this.prisma.user.create({
        data: {
          companyId: invite.companyId,
          email: invite.email,
          ssoSubject: payload.sub,
          displayName: payload.name || invite.email.split('@')[0],
          platformRole: invite.platformRole,
        },
      });

      if (invite.departmentCode && invite.departmentRole) {
        const dept = await this.prisma.department.findUnique({
          where: { companyId_code: { companyId: invite.companyId, code: invite.departmentCode } }
        });
        if (dept) {
          await this.prisma.departmentMember.create({
            data: {
              departmentId: dept.id,
              userId: newUser.id,
              departmentRole: invite.departmentRole
            }
          });
        }
      }

      await this.prisma.invitation.delete({ where: { id: invite.id } });
      user = newUser;
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { ssoSubject: payload.sub },
      });
    }

    if (!user.active) {
      throw new UnauthorizedException('Account is inactive');
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
