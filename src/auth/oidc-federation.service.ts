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

  async initiateOidcLogin(
    companyId: string,
    providerName: string,
    redirectUri?: string,
  ): Promise<{
    authorizationUrl: string;
    state: string;
    codeVerifier: string;
  }> {
    const provider = await this.prisma.oidcProvider.findFirst({
      where: { companyId, name: providerName, active: true },
    });
    if (!provider) throw new NotFoundException('OIDC provider not found');

    // The IdP enforces its own registered redirect URIs; we additionally
    // allow only the registered URI or our native-app scheme.
    const finalRedirectUri = redirectUri || provider.redirectUri;
    if (finalRedirectUri !== provider.redirectUri && !finalRedirectUri.startsWith('eurisko-hub://')) {
      throw new BadRequestException('Invalid redirect URI for this provider');
    }

    const state = this.jwtService.sign(
      { type: 'oidc_state', jti: crypto.randomBytes(16).toString('hex'), companyId, providerName },
      { expiresIn: '10m' },
    );
    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const discovery = await this.fetchDiscovery(provider);
    const authorizationEndpoint =
      discovery.authorization_endpoint ||
      `${provider.discoveryUrl.replace('/.well-known/openid-configuration', '')}/authorize`;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: provider.clientId,
      redirect_uri: finalRedirectUri,
      scope: provider.scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizationUrl = `${authorizationEndpoint}?${params.toString()}`;

    this.logger.log(`OIDC login initiated: provider=${providerName} company=${companyId}`);

    return { authorizationUrl, state, codeVerifier };
  }

  private async fetchDiscovery(provider: { discoveryUrl: string }): Promise<any> {
    let response: Response;
    try {
      response = await fetch(provider.discoveryUrl, { signal: AbortSignal.timeout(10000) });
    } catch (e: any) {
      throw new BadRequestException(`Identity provider unreachable: ${e.message}`);
    }
    if (!response.ok) {
      throw new BadRequestException('Identity provider discovery failed');
    }
    return response.json();
  }

  private async verifyIdToken(provider: { clientId: string; issuer: string }, discovery: any, idToken: string): Promise<any> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Malformed identity token');
    const [headerB64, payloadB64, signatureB64] = parts;

    let header: any;
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Malformed identity token header');
    }
    if ((header.alg !== 'RS256' && header.alg !== 'ES256') || !header.kid) {
      throw new UnauthorizedException('Unsupported identity token algorithm');
    }
    if (!discovery.jwks_uri) throw new UnauthorizedException('Identity provider has no JWKS endpoint');

    let jwks: any;
    try {
      const res = await fetch(discovery.jwks_uri, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      jwks = await res.json();
    } catch (e: any) {
      throw new UnauthorizedException(`Identity provider key fetch failed: ${e.message}`);
    }
    const jwk = (jwks.keys || []).find((k: any) => k.kid === header.kid);
    if (!jwk) throw new UnauthorizedException('Unknown identity token signing key');

    let signatureValid = false;
    try {
      const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      signatureValid = crypto.verify(
        'sha256',
        Buffer.from(`${headerB64}.${payloadB64}`),
        publicKey,
        Buffer.from(signatureB64, 'base64url'),
      );
    } catch {
      throw new UnauthorizedException('Identity token signature check failed');
    }
    if (!signatureValid) throw new UnauthorizedException('Invalid identity token signature');

    let payload: any;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Malformed identity token payload');
    }

    const now = Math.floor(Date.now() / 1000);
    const expectedIssuers = [discovery.issuer, provider.issuer].filter(Boolean);
    if (!expectedIssuers.includes(payload.iss)) {
      throw new UnauthorizedException('Invalid identity token issuer');
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(provider.clientId)) {
      throw new UnauthorizedException('Identity token was not issued for this app');
    }
    if (typeof payload.exp !== 'number' || payload.exp <= now) {
      throw new UnauthorizedException('Expired identity token');
    }
    return payload;
  }

  async handleOidcCallback(
    companyId: string,
    providerName: string,
    code: string,
    codeVerifier: string,
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

    // Stateless CSRF protection: state is a short-lived JWT minted by
    // initiateOidcLogin and must match this company + provider.
    try {
      const statePayload: any = await this.jwtService.verifyAsync(state);
      if (
        statePayload.type !== 'oidc_state' ||
        statePayload.companyId !== companyId ||
        statePayload.providerName !== providerName
      ) {
        throw new Error('state mismatch');
      }
    } catch {
      throw new UnauthorizedException('Invalid or expired login session');
    }

    const provider = await this.prisma.oidcProvider.findFirst({
      where: { companyId, name: providerName, active: true },
    });
    if (!provider) throw new NotFoundException('OIDC provider not found');

    const discovery = await this.fetchDiscovery(provider);
    if (!discovery.token_endpoint) {
      throw new UnauthorizedException('Identity provider has no token endpoint');
    }

    let tokenResponse: any;
    try {
      const response = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: provider.redirectUri,
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(15000),
      });
      tokenResponse = await response.json();
      if (!response.ok || tokenResponse.error) {
        throw new Error(tokenResponse.error_description || tokenResponse.error || `HTTP ${response.status}`);
      }
    } catch (e: any) {
      if (e instanceof UnauthorizedException) throw e;
      this.logger.warn(`[${requestId}] OIDC token exchange failed: ${e.message}`);
      throw new UnauthorizedException('OIDC token exchange failed');
    }

    if (!tokenResponse.id_token) {
      throw new UnauthorizedException('No id_token in OIDC response');
    }

    const idPayload = await this.verifyIdToken(provider, discovery, tokenResponse.id_token);
    const email: string | undefined = idPayload.email;
    if (!email) {
      throw new UnauthorizedException('No email in identity token');
    }
    if (idPayload.email_verified === false) {
      throw new UnauthorizedException('Identity provider email not verified');
    }

    const normalizedEmail = email.toLowerCase();

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (company.domain) {
      const emailDomain = normalizedEmail.split('@')[1]?.toLowerCase();
      if (emailDomain !== company.domain.toLowerCase()) {
        this.logger.warn(`[${requestId}] OIDC login: domain mismatch email=${email} expected=${company.domain}`);
        throw new UnauthorizedException('Email domain does not match company domain');
      }
    }

    let user = await this.prisma.user.findFirst({
      where: { companyId, email: normalizedEmail },
    });

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          companyId,
          email: normalizedEmail,
          displayName: idPayload.name || idPayload.preferred_username || normalizedEmail.split('@')[0],
          platformRole: 'EMPLOYEE',
          ssoSubject: idPayload.sub,
        },
      });
      isNewUser = true;
      this.logger.log(`[${requestId}] OIDC user created: ${normalizedEmail} company=${companyId}`);
    } else if (!user.ssoSubject) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { ssoSubject: idPayload.sub },
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

    this.logger.log(`[${requestId}] OIDC login OK: email=${normalizedEmail} company=${companyId} provider=${providerName}`);

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
