import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
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

const defaultGoogleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async discover(email: string): Promise<{ provider: string; googleClientId?: string; companySlug: string; companyName: string }> {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) throw new NotFoundException('Invalid email');

    const company = await this.prisma.company.findFirst({
      where: { domain, active: true },
      select: { id: true, name: true, slug: true, ssoProvider: true, googleClientId: true },
    });

    if (!company) {
      throw new NotFoundException(`No company configured for domain '${domain}'. Contact your admin to set up SSO.`);
    }

    return {
      provider: company.ssoProvider || 'GOOGLE',
      googleClientId: company.googleClientId || undefined,
      companySlug: company.slug,
      companyName: company.name,
    };
  }

  async validateGoogleToken(idToken: string): Promise<GoogleAuthResult> {
    const ticket = await defaultGoogleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.sub) {
      throw new UnauthorizedException('Invalid Google token');
    }

    const domain = payload.email.split('@')[1]?.toLowerCase();
    if (!domain) {
      throw new UnauthorizedException('Invalid email domain');
    }

    const company = await this.prisma.company.findFirst({
      where: { domain, active: true },
      select: { id: true, ssoProvider: true, googleClientId: true },
    });

    if (!company) {
      throw new UnauthorizedException(`No company configured for domain '${domain}'`);
    }

    if (company.googleClientId) {
      const audience = ticket.getPayload()?.aud;
      if (audience !== company.googleClientId) {
        throw new UnauthorizedException('Google token audience does not match company configuration');
      }
    }

    let user = await this.prisma.user.findFirst({
      where: { companyId: company.id, email: payload.email },
      select: { id: true, companyId: true, platformRole: true, displayName: true, email: true, active: true },
    });

    let newCompany = false;

    const invite = await this.prisma.invitation.findFirst({
      where: { email: payload.email, companyId: company.id, expiresAt: { gt: new Date() } }
    });

    if (invite) {
      if (user) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            platformRole: invite.platformRole,
            ssoSubject: payload.sub,
          },
          select: { id: true, companyId: true, platformRole: true, displayName: true, email: true, active: true },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            companyId: company.id,
            email: invite.email,
            ssoSubject: payload.sub,
            displayName: payload.name || invite.email.split('@')[0],
            platformRole: invite.platformRole,
          },
        });
      }

      if (invite.departmentCode && invite.departmentRole) {
        const dept = await this.prisma.department.findUnique({
          where: { companyId_code: { companyId: company.id, code: invite.departmentCode } }
        });
        if (dept) {
          await this.prisma.departmentMember.upsert({
            where: { departmentId_userId: { userId: user.id, departmentId: dept.id } },
            update: { departmentRole: invite.departmentRole },
            create: { userId: user.id, departmentId: dept.id, departmentRole: invite.departmentRole },
          });
        }
      }

      await this.prisma.invitation.delete({ where: { id: invite.id } });
    } else if (!user) {
      user = await this.prisma.user.findFirst({
        where: { email: payload.email },
        select: { id: true, companyId: true, platformRole: true, displayName: true, email: true, active: true },
      });

      if (!user) {
        throw new UnauthorizedException(
          `No account found for ${payload.email}. You must be invited by your company admin before signing in.`
        );
      }
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
    const { tokens } = await defaultGoogleClient.getToken({ code, redirect_uri: redirectUri });
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
