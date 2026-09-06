import { Injectable, UnauthorizedException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { OAuth2Client } from 'google-auth-library';
import { PlatformRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

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

const SALT_ROUNDS = 12;

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

  // ─── DISCOVER ────────────────────────────────────────────────────
  async discover(email: string) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) throw new BadRequestException('Invalid email');

    // 1. Check if a company owns this domain (SSO mode)
    const ssoCompany = await this.prisma.company.findFirst({
      where: { domain, active: true },
      select: { id: true, name: true, slug: true, authMode: true, ssoProvider: true, googleClientId: true },
    });

    if (ssoCompany) {
      return {
        authMode: 'SSO' as const,
        companySlug: ssoCompany.slug,
        companyName: ssoCompany.name,
        companyId: ssoCompany.id,
        provider: ssoCompany.ssoProvider || 'GOOGLE',
        googleClientId: ssoCompany.googleClientId || undefined,
      };
    }

    // 2. Check if a user with this email exists in any PASSWORD-mode company
    const existingUser = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), active: true },
      select: { id: true, companyId: true, passwordHash: true, company: { select: { name: true, slug: true, authMode: true } } },
    });

    if (existingUser && existingUser.company.authMode === 'PASSWORD') {
      return {
        authMode: 'PASSWORD' as const,
        companySlug: existingUser.company.slug,
        companyName: existingUser.company.name,
        companyId: existingUser.companyId,
      };
    }

    // 3. No company or user found — new user can register
    return {
      authMode: 'REGISTER' as const,
      companySlug: null,
      companyName: null,
      companyId: null,
    };
  }

  // ─── PASSWORD LOGIN ──────────────────────────────────────────────
  async loginPassword(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), active: true },
      select: { id: true, companyId: true, platformRole: true, displayName: true, email: true, passwordHash: true, active: true },
    });

    if (!user) throw new UnauthorizedException('Invalid email or password');
    if (!user.passwordHash) throw new UnauthorizedException('This account uses SSO. Please sign in with Google.');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    // Auto-claim pending invitations
    await this.claimPendingInvitations(user.email, user.companyId, user.id);

    const payload = {
      sub: user.id,
      companyId: user.companyId,
      role: user.platformRole,
      name: user.displayName,
      email: user.email,
    };

    return { accessToken: this.jwt.sign(payload) };
  }

  // ─── PASSWORD REGISTRATION ───────────────────────────────────────
  async registerPassword(dto: {
    email: string;
    password: string;
    displayName: string;
    companyName?: string;
    companySlug?: string;
  }): Promise<{ accessToken: string; newCompany: boolean }> {
    const email = dto.email.toLowerCase().trim();
    const domain = email.split('@')[1];

    // Check if user already exists
    const existing = await this.prisma.user.findFirst({
      where: { email, active: true },
    });
    if (existing) throw new ConflictException('An account with this email already exists');

    // Check for pending invitation
    const invitation = await this.prisma.invitation.findFirst({
      where: { email, expiresAt: { gt: new Date() } },
      include: { company: { select: { id: true, name: true, slug: true, authMode: true } } },
    });

    let companyId: string;
    let platformRole: PlatformRole = PlatformRole.EMPLOYEE;
    let newCompany = false;

    if (invitation) {
      // Join the inviting company
      companyId = invitation.companyId;
      platformRole = invitation.platformRole;
    } else if (dto.companySlug) {
      // Registering a new company
      const company = await this.prisma.company.findUnique({
        where: { slug: dto.companySlug },
        select: { id: true },
      });
      if (!company) throw new NotFoundException('Company not found');
      companyId = company.id;
      platformRole = PlatformRole.SYSTEM_ADMIN;
      newCompany = true;
    } else if (domain) {
      // Try to find company by domain
      const company = await this.prisma.company.findFirst({
        where: { domain, active: true },
        select: { id: true },
      });
      if (company) {
        companyId = company.id;
      } else {
        throw new BadRequestException(
          'No company found for this email domain. Ask your admin for an invitation, or register a new company.'
        );
      }
    } else {
      throw new BadRequestException('Company slug or valid email domain required');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        companyId,
        email,
        passwordHash,
        displayName: dto.displayName.trim() || email.split('@')[0],
        platformRole,
        ssoSubject: null,
      },
      select: { id: true, companyId: true, platformRole: true, displayName: true, email: true },
    });

    // Claim pending invitation if exists
    if (invitation) {
      await this.claimInvitation(invitation.id, user.id, companyId, invitation);
    }

    const jwtPayload = {
      sub: user.id,
      companyId: user.companyId,
      role: user.platformRole,
      name: user.displayName,
      email: user.email,
    };

    return { accessToken: this.jwt.sign(jwtPayload), newCompany };
  }

  // ─── ACCEPT INVITE (set password) ────────────────────────────────
  async acceptInvite(token: string, password: string): Promise<{ accessToken: string }> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: { company: { select: { id: true, name: true } } },
    });

    if (!invitation) throw new NotFoundException('Invalid or expired invitation');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('Invitation has expired');

    // Check if user already exists
    const existingUser = await this.prisma.user.findFirst({
      where: { email: invitation.email, companyId: invitation.companyId },
    });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    let user;
    if (existingUser) {
      // Update existing user with password
      user = await this.prisma.user.update({
        where: { id: existingUser.id },
        data: {
          passwordHash,
          platformRole: invitation.platformRole,
          active: true,
        },
        select: { id: true, companyId: true, platformRole: true, displayName: true, email: true },
      });
    } else {
      // Create new user
      user = await this.prisma.user.create({
        data: {
          companyId: invitation.companyId,
          email: invitation.email,
          passwordHash,
          displayName: invitation.email.split('@')[0],
          platformRole: invitation.platformRole,
          ssoSubject: null,
        },
        select: { id: true, companyId: true, platformRole: true, displayName: true, email: true },
      });
    }

    // Add to department if specified
    if (invitation.departmentCode && invitation.departmentRole) {
      const dept = await this.prisma.department.findUnique({
        where: { companyId_code: { companyId: invitation.companyId, code: invitation.departmentCode } },
      });
      if (dept) {
        await this.prisma.departmentMember.upsert({
          where: { departmentId_userId: { userId: user.id, departmentId: dept.id } },
          update: { departmentRole: invitation.departmentRole },
          create: { userId: user.id, departmentId: dept.id, departmentRole: invitation.departmentRole },
        });
      }
    }

    // Delete the invitation
    await this.prisma.invitation.delete({ where: { id: invitation.id } });

    const jwtPayload = {
      sub: user.id,
      companyId: user.companyId,
      role: user.platformRole,
      name: user.displayName,
      email: user.email,
    };

    return { accessToken: this.jwt.sign(jwtPayload) };
  }

  // ─── VALIDATE INVITE TOKEN ───────────────────────────────────────
  async validateInviteToken(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      select: { id: true, email: true, platformRole: true, departmentCode: true, expiresAt: true, company: { select: { name: true, slug: true } } },
    });

    if (!invitation) throw new NotFoundException('Invalid invitation');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('Invitation has expired');

    return {
      email: invitation.email,
      role: invitation.platformRole,
      department: invitation.departmentCode,
      companyName: invitation.company.name,
      companySlug: invitation.company.slug,
      expiresAt: invitation.expiresAt,
    };
  }

  // ─── GOOGLE SSO (existing) ──────────────────────────────────────
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
      select: { id: true, authMode: true, ssoProvider: true, googleClientId: true },
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
      where: { email: payload.email, companyId: company.id, expiresAt: { gt: new Date() } },
    });

    if (invite) {
      if (user) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { platformRole: invite.platformRole, ssoSubject: payload.sub },
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
          where: { companyId_code: { companyId: company.id, code: invite.departmentCode } },
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

  // ─── HELPERS ─────────────────────────────────────────────────────
  private async claimPendingInvitations(email: string, companyId: string, userId: string) {
    const invitations = await this.prisma.invitation.findMany({
      where: { email, expiresAt: { gt: new Date() } },
    });

    for (const invite of invitations) {
      await this.claimInvitation(invite.id, userId, invite.companyId, invite);
    }
  }

  private async claimInvitation(
    invitationId: string,
    userId: string,
    companyId: string,
    invite: { departmentCode?: string | null; departmentRole?: string | null; platformRole: string },
  ) {
    // Add to department if specified
    if (invite.departmentCode && invite.departmentRole) {
      const dept = await this.prisma.department.findUnique({
        where: { companyId_code: { companyId, code: invite.departmentCode } },
      });
      if (dept) {
        await this.prisma.departmentMember.upsert({
          where: { departmentId_userId: { userId, departmentId: dept.id } },
          update: { departmentRole: invite.departmentRole as any },
          create: { userId, departmentId: dept.id, departmentRole: invite.departmentRole as any },
        });
      }
    }

    // Delete the invitation
    await this.prisma.invitation.delete({ where: { id: invitationId } }).catch(() => {});
  }
}
