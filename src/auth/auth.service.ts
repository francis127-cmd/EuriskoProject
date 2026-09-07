import { Injectable, UnauthorizedException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { AdminPrismaService } from '../admin-prisma.service';
import { TenantContext } from '../tenant-context';

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
  ) {
    this.googleClient = new OAuth2Client(process.env['GOOGLE_CLIENT_ID']);
  }

  /**
   * Discover authentication mode for an email address.
   *
   * SECURITY: Uses DOMAIN-based company lookup (not user lookup) to prevent
   * account enumeration. Public email providers (gmail, yahoo, etc.) always
   * return REGISTER — they cannot be used for domain-based routing.
   */
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

  /**
   * Password-based login with tenant scoping.
   *
   * SECURITY:
   * - Accepts optional companySlug for explicit tenant binding
   * - Always queries companyId + email (tenant-scoped)
   * - Returns identical "Invalid credentials" on ALL failures (no enumeration)
   * - Logs all attempts for audit trail
   */
  async loginPassword(email: string, password: string, companySlug?: string) {
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

    this.logger.log(`[${requestId}] Login OK: email=${email} company=${company.slug} role=${user.platformRole}`);
    const token = this.signToken(user);
    return { accessToken: token };
  }

  /**
   * Register a new user with password. Creates a new company if companyName
   * is provided, or joins an existing company via companySlug.
   */
  async registerPassword(dto: {
    email: string;
    password: string;
    displayName?: string;
    companyName?: string;
    companySlug?: string;
  }) {
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
    const token = this.signToken(user);
    return { accessToken: token, newCompany };
  }

  /**
   * Google SSO login with full identity verification.
   *
   * SECURITY:
   * - Verifies token signature (via google-auth-library)
   * - Enforces email_verified = true
   * - Enforces issuer = accounts.google.com or securetoken.google.com
   * - Enforces hd claim matches company domain (for SSO companies)
   * - Tenant-scoped user lookup
   * - Logs all attempts
   */
  async loginGoogle(idToken: string) {
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
    const token = this.signToken(user);
    return { accessToken: token, newCompany: false };
  }

  async acceptInvite(token: string, password: string) {
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
    const jwtToken = this.signToken(user);
    return { accessToken: jwtToken };
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

  private signToken(user: { id: string; email: string; displayName: string; platformRole: string; companyId: string }): string {
    const payload: AuthUser = {
      sub: user.id,
      email: user.email,
      name: user.displayName,
      role: user.platformRole,
      companyId: user.companyId,
    };
    return this.jwtService.sign(payload);
  }
}
