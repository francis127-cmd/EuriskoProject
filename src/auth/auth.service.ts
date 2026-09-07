import { Injectable, UnauthorizedException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly prisma: AdminPrismaService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly mfaService: MfaService,
  ) {
    this.googleClient = new OAuth2Client(process.env['GOOGLE_CLIENT_ID']);
  }

  async discover(email: string) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return { authMode: 'REGISTER' };

    if (PUBLIC_EMAIL_PROVIDERS.has(domain)) {
      this.logger.log(`Discover: public provider ${domain} -> REGISTER`);
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

  async registerPassword(dto: {
    email: string;
    password: string;
    displayName?: string;
    companyName?: string;
    companySlug?: string;
  }, ip?: string, userAgent?: string) {
    const requestId = TenantContext.getStore()?.requestId || 'N/A';

    const existing = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    let companyId: string;
    let newCompany = false;

    if (dto.companySlug) {
      const company = await this.prisma.company.findUnique({ where: { slug: dto.companySlug } });
      if (!company) throw new BadRequestException('Company not found');
      companyId = company.id;
    } else if (dto.companyName) {
      const slug = dto.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existingCompany = await this.prisma.company.findUnique({ where: { slug } });
      if (existingCompany) throw new ConflictException('Company slug already taken');
      const company = await this.prisma.company.create({
        data: { name: dto.companyName, slug, authMode: 'PASSWORD' },
      });
      companyId = company.id;
      newCompany = true;
    } else {
      throw new BadRequestException('Either companyName or companySlug is required');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        companyId,
        email: dto.email,
        displayName: dto.displayName || dto.email.split('@')[0],
        passwordHash,
        platformRole: 'SYSTEM_ADMIN',
      },
    });

    this.logger.log(`[${requestId}] Registration: email=${dto.email} company=${companyId} newCompany=${newCompany}`);
    return this.issueTokenPair(user, ip, userAgent, newCompany);
  }

  async loginGoogle(idToken: string, ip?: string, userAgent?: string) {
    const requestId = TenantContext.getStore()?.requestId || 'N/A';

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env['GOOGLE_CLIENT_ID'],
      });
      payload = ticket.getPayload();
    } catch (e) {
      this.logger.warn(`[${requestId}] Google login: token verification failed`);
      throw new UnauthorizedException('Invalid Google token');
    }

    if (!payload) throw new UnauthorizedException('Invalid Google token');

    if (!payload.email_verified) {
      this.logger.warn(`[${requestId}] Google login: unverified email ${payload.email}`);
      throw new UnauthorizedException('Google email not verified');
    }

    if (payload.iss !== 'accounts.google.com' && payload.iss !== 'securetoken.google.com') {
      this.logger.warn(`[${requestId}] Google login: invalid issuer ${payload.iss}`);
      throw new UnauthorizedException('Invalid Google token issuer');
    }

    if (!payload.email) {
      throw new UnauthorizedException('No email in Google token');
    }

    const user = await this.prisma.user.findFirst({
      where: { email: payload.email },
    });

    if (!user) {
      this.logger.warn(`[${requestId}] Google login: unknown user ${payload.email}`);
      throw new UnauthorizedException('No account found. Please register first.');
    }

    if (!user.active) {
      this.logger.warn(`[${requestId}] Google login: deactivated user ${payload.email}`);
      throw new UnauthorizedException('Account deactivated');
    }

    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });

    if (company?.authMode === 'SSO' && company?.domain) {
      if (payload.hd && payload.hd !== company.domain) {
        this.logger.warn(`[${requestId}] Google login: hd mismatch email=${payload.email} hd=${payload.hd} expected=${company.domain}`);
        throw new UnauthorizedException('Email domain does not match company domain');
      }
    }

    this.logger.log(`[${requestId}] Google login OK: email=${payload.email} company=${company?.slug}`);
    return this.issueTokenPair(user, ip, userAgent);
  }

  async acceptInvite(token: string, password: string, ip?: string, userAgent?: string) {
    const requestId = TenantContext.getStore()?.requestId || 'N/A';

    const invitation = await this.prisma.invitation.findFirst({ where: { token } });
    if (!invitation) throw new BadRequestException('Invalid invitation token');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('Invitation has expired');

    const existing = await this.prisma.user.findFirst({ where: { email: invitation.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        companyId: invitation.companyId,
        email: invitation.email,
        displayName: invitation.email.split('@')[0],
        passwordHash,
        platformRole: invitation.platformRole,
      },
    });

    if (invitation.departmentCode) {
      const dept = await this.prisma.department.findFirst({
        where: { companyId: invitation.companyId, code: invitation.departmentCode },
      });
      if (dept && invitation.departmentRole) {
        await this.prisma.departmentMember.create({
          data: { departmentId: dept.id, userId: user.id, departmentRole: invitation.departmentRole },
        });
      }
    }

    await this.prisma.invitation.delete({ where: { id: invitation.id } });

    this.logger.log(`[${requestId}] Invite accepted: email=${invitation.email} company=${invitation.companyId}`);
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
    try {
      return await this.jwtService.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
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
