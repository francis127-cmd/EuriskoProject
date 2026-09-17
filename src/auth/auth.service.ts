import { Injectable, UnauthorizedException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { AdminPrismaService } from '../admin-prisma.service';
import { TenantContext } from '../tenant-context';
import { RefreshTokenService } from './refresh-token.service';
import { MfaService } from './mfa.service';

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
  role: string;
  companyId: string;
}

const PUBLIC_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
  'live.com', 'msn.com', 'me.com', 'inbox.com', 'gmx.com',
]);

// Single global Google Client ID for the entire app — no per-company IDs needed.
// Prefer the GOOGLE_CLIENT_ID env var (e.g. on Render); fall back to the
// registered web client so local/dev works without extra configuration.
const GOOGLE_CLIENT_ID_FALLBACK = '804630899699-d6eceuaat3io3p1f65ihvsejfgpnatcn.apps.googleusercontent.com';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;
  private readonly googleClientId: string;

  constructor(
    private readonly prisma: AdminPrismaService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly mfaService: MfaService,
    private readonly configService: ConfigService,
  ) {
    // Use the single global Client ID for token verification
    this.googleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID') || GOOGLE_CLIENT_ID_FALLBACK;
    if (!this.configService.get<string>('GOOGLE_CLIENT_ID')) {
      this.logger.warn('GOOGLE_CLIENT_ID is not set — falling back to built-in global Google client ID');
    }
    this.googleClient = new OAuth2Client(this.googleClientId);
  }

  async discover(email: string) {
    if (!email || !email.includes('@')) {
      throw new BadRequestException('A valid email address is required');
    }
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return { authMode: 'REGISTER' };

    const existingUser = await this.prisma.user.findFirst({
      where: { email },
      select: { id: true, companyId: true, company: { select: { slug: true, name: true, authMode: true, ssoProvider: true, googleClientId: true } } },
    });

    if (existingUser) {
      this.logger.log(`Discover: known user ${email} -> ${existingUser.company.slug} (${existingUser.company.authMode})`);
      return {
        authMode: existingUser.company.authMode || 'PASSWORD',
        companySlug: existingUser.company.slug,
        companyName: existingUser.company.name,
        companyId: existingUser.companyId,
        provider: existingUser.company.ssoProvider,
        googleClientId: existingUser.company.googleClientId,
      };
    }

    if (PUBLIC_EMAIL_PROVIDERS.has(domain)) {
      this.logger.log(`Discover: public provider ${domain}, no user -> REGISTER`);
      return { authMode: 'REGISTER' };
    }

    const company = await this.prisma.company.findFirst({ where: { domain } });
    if (!company) {
      this.logger.log(`Discover: no company for domain ${domain} -> REGISTER`);
      return { authMode: 'REGISTER' };
    }

    this.logger.log(`Discover: domain ${domain} -> ${company.slug} (${company.authMode})`);
    return {
      authMode: company.authMode || 'PASSWORD',
      companySlug: company.slug,
      companyName: company.name,
      companyId: company.id,
      provider: company.ssoProvider,
      googleClientId: company.googleClientId,
    };
  }

  async loginPassword(email: string, password: string, companySlug?: string, ip?: string, userAgent?: string) {
    const requestId = TenantContext.getStore()?.requestId || 'N/A';
    let company: any;

    if (companySlug) {
      company = await this.prisma.company.findUnique({ where: { slug: companySlug } });
    } else {
      const domain = email.split('@')[1]?.toLowerCase();
      if (!domain) {
        this.logger.warn(`[${requestId}] Login failed: no domain in email`);
        throw new UnauthorizedException('Invalid credentials');
      }
      company = await this.prisma.company.findFirst({ where: { domain } });
    }

    if (!company) {
      this.logger.warn(`[${requestId}] Login failed: unknown company slug=${companySlug || 'N/A'} email=${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = await this.prisma.user.findFirst({
      where: { companyId: company.id, email },
    });

    if (!user || !user.passwordHash) {
      this.logger.warn(`[${requestId}] Login failed: unknown user email=${email} company=${company.slug}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.active) {
      this.logger.warn(`[${requestId}] Login failed: deactivated user email=${email} company=${company.slug}`);
      throw new UnauthorizedException('Account deactivated');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      this.logger.warn(`[${requestId}] Login failed: wrong password email=${email} company=${company.slug}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const mfaEnabled = await this.mfaService.getMfaStatus(user.id);
    if (mfaEnabled.enabled && company.mfaRequired) {
      this.logger.log(`[${requestId}] MFA required: email=${email} company=${company.slug}`);
      const mfaToken = this.jwtService.sign(
        { sub: user.id, type: 'mfa_pending', companyId: user.companyId },
        { expiresIn: '5m' },
      );
      return { mfaRequired: true, mfaToken };
    }

    this.logger.log(`[${requestId}] Login OK: email=${email} company=${company.slug} role=${user.platformRole}`);
    return this.issueTokenPair(user, ip, userAgent);
  }

  async completeMfaChallenge(mfaToken: string, mfaCode: string, ip?: string, userAgent?: string) {
    const requestId = TenantContext.getStore()?.requestId || 'N/A';

    let payload: any;
    try {
      payload = this.jwtService.verify(mfaToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA session');
    }

    if (payload.type !== 'mfa_pending') {
      throw new UnauthorizedException('Invalid token type');
    }

    const verified = await this.mfaService.verifyMfaToken(payload.sub, mfaCode);
    if (!verified) {
      this.logger.warn(`[${requestId}] MFA challenge failed for user ${payload.sub}`);
      throw new UnauthorizedException('Invalid MFA code');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Account not found or deactivated');
    }

    this.logger.log(`[${requestId}] MFA challenge passed for user ${user.email}`);
    return this.issueTokenPair(user, ip, userAgent);
  }

  async loginGoogle(idToken: string, ip?: string, userAgent?: string) {
    const requestId = TenantContext.getStore()?.requestId || 'N/A';

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });
      payload = ticket.getPayload();
    } catch (e) {
      // Decode (not verify) the token payload purely for diagnostics so a
      // client-ID mismatch is visible in logs instead of a generic 401.
      let debugAud = 'unparseable';
      let debugEmail = 'unparseable';
      try {
        const parts = idToken.split('.');
        if (parts.length === 3 && parts[1]) {
          const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { aud?: unknown; email?: unknown };
          debugAud = String(decoded.aud ?? 'missing');
          debugEmail = String(decoded.email ?? 'missing');
        }
      } catch {}
      this.logger.warn(
        `[${requestId}] Google login: token verification failed (expected aud=${this.googleClientId} token aud=${debugAud} email=${debugEmail})`,
      );
      throw new UnauthorizedException('Invalid Google token');
    }

    if (!payload) throw new UnauthorizedException('Invalid Google token');

    if (!payload.email_verified) {
      this.logger.warn(`[${requestId}] Google login: unverified email ${payload.email}`);
      throw new UnauthorizedException('Google email not verified');
    }

    // Real Google ID tokens carry iss "https://accounts.google.com" (with
    // scheme). verifyIdToken already validated the issuer; this is a
    // defense-in-depth check that must accept both forms.
    const allowedIssuers = new Set([
      'accounts.google.com',
      'https://accounts.google.com',
      'securetoken.google.com',
      'https://securetoken.google.com',
    ]);
    if (!payload.iss || !allowedIssuers.has(payload.iss)) {
      this.logger.warn(`[${requestId}] Google login: invalid issuer ${payload.iss}`);
      throw new UnauthorizedException('Invalid Google token issuer');
    }

    if (!payload.email) {
      throw new UnauthorizedException('No email in Google token');
    }

    const normalizedEmail = payload.email.toLowerCase();
    const emailDomain = normalizedEmail.split('@')[1]?.toLowerCase();
    const tokenDomain = payload.hd?.toLowerCase() || emailDomain;

    // Existing users: route by established membership, not by token domain.
    // (A token domain can map to a different company — e.g. a Gmail admin of
    // a Workspace-domain company — while discover already resolved the right
    // one. The membership itself was verified at invite/registration/JIT time,
    // and the token proves ownership of the exact email address.)
    const existingUsers = await this.prisma.user.findMany({
      where: { email: normalizedEmail },
      include: { company: true },
    });

    let company: NonNullable<(typeof existingUsers)[number]['company']> | null = null;
    let user: (typeof existingUsers)[number] | null = null;

    if (existingUsers.length === 1) {
      const found = existingUsers[0];
      if (!found) throw new UnauthorizedException('Invalid Google token');
      user = found;
      company = found.company;
    } else if (existingUsers.length > 1) {
      // Same email in several companies: disambiguate via the token domain.
      const match =
        existingUsers.find((u) => u.company.domain?.toLowerCase() === tokenDomain) || null;
      if (!match) {
        this.logger.warn(`[${requestId}] Google login: email ${payload.email} exists in multiple companies, none matching ${tokenDomain}`);
        throw new UnauthorizedException('This email belongs to multiple workspaces. Please sign in with email and password.');
      }
      user = match;
      company = match.company;
    } else {
      const routed = tokenDomain
        ? await this.prisma.company.findFirst({ where: { domain: tokenDomain } })
        : null;
      if (!routed) {
        throw new UnauthorizedException('No company is configured for this Google account');
      }
      company = routed;
    }

    // Company gates: Google login only for SSO companies. The domain-match
    // gate applies to JIT provisioning; pre-existing members are already bound
    // to their company by invite/registration.
    if (company.authMode !== 'SSO') {
      throw new UnauthorizedException('Google sign-in is not enabled for this company');
    }

    if (!user) {
      if (company.domain && emailDomain !== company.domain.toLowerCase()) {
        this.logger.warn(`[${requestId}] Google login: domain mismatch email=${payload.email} expected=${company.domain}`);
        throw new UnauthorizedException('Email domain does not match company domain');
      }
      // JIT provisioning: first-time Google user with a verified,
      // domain-matching email joins as EMPLOYEE (no password, Google-only).
      // Role elevation (agent/admin) stays an explicit admin action.
      user = await this.prisma.user.create({
        data: {
          companyId: company.id,
          email: normalizedEmail,
          displayName: payload.name || normalizedEmail.split('@')[0],
          platformRole: 'EMPLOYEE',
          ssoSubject: payload.sub,
        },
        include: { company: true },
      });
      this.logger.log(`[${requestId}] Google user auto-provisioned: ${normalizedEmail} company=${company.slug}`);
    } else if (!user.ssoSubject) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { ssoSubject: payload.sub },
      });
    }

    if (!user.active) {
      this.logger.warn(`[${requestId}] Google login: deactivated user ${payload.email}`);
      throw new UnauthorizedException('Account deactivated');
    }

    this.logger.log(`[${requestId}] Google login OK: email=${payload.email} company=${company?.slug}`);
    return this.issueTokenPair(user, ip, userAgent);
  }

  async acceptInvite(token: string, password: string, displayName?: string, ip?: string, userAgent?: string) {
    const requestId = TenantContext.getStore()?.requestId || 'N/A';

    const invitation = await this.prisma.invitation.findFirst({ where: { token } });
    if (!invitation) throw new BadRequestException('Invalid invitation token');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('Invitation has expired');

    const existing = await this.prisma.user.findFirst({
      where: { companyId: invitation.companyId, email: invitation.email.toLowerCase() },
    });
    if (existing?.active) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      let user: { id: string; email: string; displayName: string; platformRole: string; companyId: string };

      if (existing) {
        // Invalidate old tokens before reactivation so stale permissions don't persist
        await this.refreshTokenService.revokeAllUserTokens(existing.id);

        user = await tx.user.update({
          where: { id: existing.id },
          data: {
            active: true,
            passwordHash,
            platformRole: invitation.platformRole,
            ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
          },
        });
      } else {
        user = await tx.user.create({
          data: {
            companyId: invitation.companyId,
            email: invitation.email,
            displayName: displayName?.trim() || invitation.email.split('@')[0],
            passwordHash,
            platformRole: invitation.platformRole,
          },
        });
      }

      if (invitation.departmentCode && invitation.departmentRole) {
        const dept = await tx.department.findFirst({
          where: { companyId: invitation.companyId, code: invitation.departmentCode },
        });
        if (dept) {
          if (existing) {
            await tx.departmentMember.upsert({
              where: { departmentId_userId: { departmentId: dept.id, userId: user.id } },
              update: { departmentRole: invitation.departmentRole, active: true },
              create: { departmentId: dept.id, userId: user.id, departmentRole: invitation.departmentRole },
            });
          } else {
            await tx.departmentMember.create({
              data: { departmentId: dept.id, userId: user.id, departmentRole: invitation.departmentRole },
            });
          }
        }
      }

      await tx.invitation.delete({ where: { id: invitation.id } });

      return user;
    });

    const action = existing ? 'reactivated' : 'new';
    this.logger.log(`[${requestId}] Invite accepted (${action}): email=${invitation.email} company=${invitation.companyId}`);
    return this.issueTokenPair(user, ip, userAgent);
  }

  async validateInviteToken(token: string) {
    const invitation = await this.prisma.invitation.findFirst({ where: { token } });
    if (!invitation) throw new BadRequestException('Invalid invitation token');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('Invitation has expired');
    const company = await this.prisma.company.findUnique({ where: { id: invitation.companyId } });
    return {
      email: invitation.email,
      role: invitation.platformRole,
      department: invitation.departmentCode,
      companyName: company?.name || 'Unknown',
      companySlug: company?.slug || 'unknown',
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async verifyToken(token: string): Promise<AuthUser> {
    let payload: AuthUser;
    try {
      payload = await this.jwtService.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, active: true },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('User account is deactivated or no longer exists');
    }

    return payload;
  }

  async logout(refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.refreshTokenService.revokeRefreshToken(refreshToken);
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokenService.revokeAllUserTokens(userId);
  }

  async refreshTokens(refreshToken: string, ip?: string, userAgent?: string) {
    return this.refreshTokenService.rotateRefreshToken(refreshToken, ip, userAgent);
  }

  private async issueTokenPair(
    user: { id: string; email: string; displayName: string; platformRole: string; companyId: string },
    ip?: string,
    userAgent?: string,
    newCompany?: boolean,
  ) {
    const accessToken = this.signAccessToken(user);
    const { refreshToken, expiresAt } = await this.refreshTokenService.generateRefreshToken(
      user.id, ip, userAgent,
    );

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
      ...(newCompany !== undefined && { newCompany }),
    };
  }

  private signAccessToken(user: { id: string; email: string; displayName: string; platformRole: string; companyId: string }): string {
    const payload: AuthUser = {
      sub: user.id,
      email: user.email,
      name: user.displayName,
      role: user.platformRole,
      companyId: user.companyId,
    };
    return this.jwtService.sign(payload, { expiresIn: '15m' });
  }
}
