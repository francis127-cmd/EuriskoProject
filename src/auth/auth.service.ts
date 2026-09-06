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

export interface GoogleAuthResult {
  user: AuthUser;
  newCompany: boolean;
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

  async validateGoogleToken(idToken: string): Promise<GoogleAuthResult> {
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

    let newCompany = false;

    const invite = await this.prisma.invitation.findFirst({
      where: { email: payload.email, expiresAt: { gt: new Date() } }
    });

    if (invite) {
      if (user) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            companyId: invite.companyId,
            platformRole: invite.platformRole,
            ssoSubject: payload.sub,
          },
          select: { id: true, companyId: true, platformRole: true, displayName: true, email: true, active: true },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            companyId: invite.companyId,
            email: invite.email,
            ssoSubject: payload.sub,
            displayName: payload.name || invite.email.split('@')[0],
            platformRole: invite.platformRole,
          },
        });
      }

      if (invite.departmentCode && invite.departmentRole) {
        const dept = await this.prisma.department.findUnique({
          where: { companyId_code: { companyId: invite.companyId, code: invite.departmentCode } }
        });
        if (dept) {
          await this.prisma.departmentMember.upsert({
            where: { departmentIdUserId: { userId: user.id, departmentId: dept.id } },
            update: { departmentRole: invite.departmentRole },
            create: { userId: user.id, departmentId: dept.id, departmentRole: invite.departmentRole },
          });
        }
      }

      await this.prisma.invitation.delete({ where: { id: invite.id } });
    } else if (!user) {
      const name = payload.name || payload.email.split('@')[0];
      const slug = payload.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now().toString(36);

      const company = await this.prisma.company.create({
        data: { name: `${name}'s Company`, slug },
      });

      user = await this.prisma.user.create({
        data: {
          companyId: company.id,
          email: payload.email,
          ssoSubject: payload.sub,
          displayName: name,
          platformRole: 'SYSTEM_ADMIN',
        },
      });

      newCompany = true;
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
      user: {
        sub: user.id,
        companyId: user.companyId,
        platformRole: user.platformRole,
        displayName: user.displayName,
        email: user.email,
      },
      newCompany,
    };
  }

  async issueGoogleToken(idToken: string): Promise<{ accessToken: string; newCompany: boolean }> {
    const result = await this.validateGoogleToken(idToken);
    const payload = { sub: result.user.sub, companyId: result.user.companyId, role: result.user.platformRole, name: result.user.displayName, email: result.user.email };
    return { accessToken: this.jwt.sign(payload), newCompany: result.newCompany };
  }

  async exchangeGoogleCode(code: string): Promise<{ accessToken: string }> {
    const redirectUri = `${process.env.BACKEND_URL || 'https://euriskoproject.onrender.com'}/auth/google/callback`;
    const { tokens } = await googleClient.getToken({ code, redirect_uri: redirectUri });
    if (!tokens.id_token) {
      throw new UnauthorizedException('No ID token received from Google');
    }
    const result = await this.issueGoogleToken(tokens.id_token);
    return { accessToken: result.accessToken };
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
