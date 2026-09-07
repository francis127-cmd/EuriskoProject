import { Injectable, BadRequestException, UnauthorizedException, NotFoundException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminPrismaService } from '../admin-prisma.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { TenantContext } from '../tenant-context';
import * as crypto from 'crypto';

@Injectable()
export class OidcFederationService {
  private readonly logger = new Logger(OidcFederationService.name);

  constructor(
    private readonly prisma: AdminPrismaService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async discoverProviders(companyId: string): Promise<{
    providers: { name: string; issuer: string; iconUrl?: string; redirectUri: string }[];
  }> {
    const providers = await this.prisma.oidcProvider.findMany({
      where: { companyId, active: true },
      select: {
        name: true,
        issuer: true,
        iconUrl: true,
        redirectUri: true,
      },
    });
    return {
      providers: providers.map((p) => ({
        name: p.name,
        issuer: p.issuer,
        iconUrl: p.iconUrl || undefined,
        redirectUri: p.redirectUri,
      })),
    };
  }

  async initiateOidcLogin(companyId: string, providerName: string): Promise<{
    authorizationUrl: string;
    state: string;
    codeVerifier: string;
  }> {
    const provider = await this.prisma.oidcProvider.findFirst({
      where: { companyId, name: providerName, active: true },
    });
    if (!provider) throw new NotFoundException('OIDC provider not found');

    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: provider.clientId,
      redirect_uri: provider.redirectUri,
      scope: provider.scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizationUrl = `${provider.discoveryUrl.replace('/.well-known/openid-configuration', '')}/authorize?${params.toString()}`;

    this.logger.log(`OIDC login initiated: provider=${providerName} company=${companyId}`);

    return { authorizationUrl, state, codeVerifier };
  }

  async handleOidcCallback(
    companyId: string,
    providerName: string,
    code: string,
    state: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
    isNewUser: boolean;
  }> {
    const requestId = TenantContext.getStore()?.requestId || 'N/A';

    const provider = await this.prisma.oidcProvider.findFirst({
      where: { companyId, name: providerName, active: true },
    });
    if (!provider) throw new NotFoundException('OIDC provider not found');

    let tokenResponse: any;
    try {
      const tokenUrl = provider.discoveryUrl.replace('/.well-known/openid-configuration', '/token');
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: provider.redirectUri,
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
          code_verifier: state,
        }),
      });
      tokenResponse = await response.json();
    } catch (e: any) {
      this.logger.warn(`[${requestId}] OIDC token exchange failed: ${e.message}`);
      throw new UnauthorizedException('OIDC token exchange failed');
    }

    if (!tokenResponse.id_token) {
      throw new UnauthorizedException('No id_token in OIDC response');
    }

    let userInfo: any;
    try {
      const userInfoUrl = provider.discoveryUrl.replace('/.well-known/openid-configuration', '/userinfo');
      const response = await fetch(userInfoUrl, {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
      });
      userInfo = await response.json();
    } catch (e: any) {
      this.logger.warn(`[${requestId}] OIDC userInfo fetch failed: ${e.message}`);
      throw new UnauthorizedException('Failed to fetch user info');
    }

    if (!userInfo.email) {
      throw new UnauthorizedException('No email in OIDC user info');
    }

    let user = await this.prisma.user.findFirst({
      where: { companyId, email: userInfo.email },
    });

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          companyId,
          email: userInfo.email,
          displayName: userInfo.name || userInfo.preferred_username || userInfo.email.split('@')[0],
          platformRole: 'EMPLOYEE',
          ssoSubject: userInfo.sub,
        },
      });
      isNewUser = true;
      this.logger.log(`[${requestId}] OIDC user created: ${userInfo.email} company=${companyId}`);
    } else if (!user.ssoSubject) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { ssoSubject: userInfo.sub },
      });
    }

    if (!user.active) {
      throw new UnauthorizedException('Account deactivated');
    }

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      name: user.displayName,
      role: user.platformRole,
      companyId: user.companyId,
    });

    const refreshTokenResult = await this.refreshTokenService.generateRefreshToken(
      user.id, ip, userAgent,
    );

    this.logger.log(`[${requestId}] OIDC login OK: email=${userInfo.email} company=${companyId} provider=${providerName}`);

    return {
      accessToken,
      refreshToken: refreshTokenResult.refreshToken,
      refreshTokenExpiresAt: refreshTokenResult.expiresAt.toISOString(),
      isNewUser,
    };
  }

  async createProvider(companyId: string, data: {
    name: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    discoveryUrl: string;
    redirectUri: string;
    scopes?: string;
    iconUrl?: string;
  }) {
    const existing = await this.prisma.oidcProvider.findFirst({
      where: { companyId, name: data.name },
    });
    if (existing) throw new BadRequestException('Provider name already exists');

    let discoveryUrl = data.discoveryUrl;
    if (!discoveryUrl.endsWith('/.well-known/openid-configuration')) {
      discoveryUrl = `${discoveryUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
    }

    const provider = await this.prisma.oidcProvider.create({
      data: {
        companyId,
        name: data.name,
        issuer: data.issuer,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        discoveryUrl,
        redirectUri: data.redirectUri,
        scopes: data.scopes || 'openid email profile',
        iconUrl: data.iconUrl || null,
      },
    });

    this.logger.log(`OIDC provider created: ${provider.name} for company ${companyId}`);

    return {
      id: provider.id,
      name: provider.name,
      issuer: provider.issuer,
      discoveryUrl: provider.discoveryUrl,
      redirectUri: provider.redirectUri,
    };
  }

  async updateProvider(companyId: string, providerId: string, data: {
    name?: string;
    clientId?: string;
    clientSecret?: string;
    scopes?: string;
    iconUrl?: string;
    active?: boolean;
  }) {
    const provider = await this.prisma.oidcProvider.findFirst({
      where: { id: providerId, companyId },
    });
    if (!provider) throw new NotFoundException('Provider not found');

    const updated = await this.prisma.oidcProvider.update({
      where: { id: providerId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.clientId !== undefined && { clientId: data.clientId }),
        ...(data.clientSecret !== undefined && { clientSecret: data.clientSecret }),
        ...(data.scopes !== undefined && { scopes: data.scopes }),
        ...(data.iconUrl !== undefined && { iconUrl: data.iconUrl }),
        ...(data.active !== undefined && { active: data.active }),
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      issuer: updated.issuer,
      active: updated.active,
    };
  }

  async deleteProvider(companyId: string, providerId: string): Promise<void> {
    const provider = await this.prisma.oidcProvider.findFirst({
      where: { id: providerId, companyId },
    });
    if (!provider) throw new NotFoundException('Provider not found');

    await this.prisma.oidcProvider.delete({ where: { id: providerId } });
  }

  async listProviders(companyId: string) {
    const providers = await this.prisma.oidcProvider.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        issuer: true,
        discoveryUrl: true,
        redirectUri: true,
        scopes: true,
        iconUrl: true,
        active: true,
        createdAt: true,
      },
    });
    return providers;
  }
}
