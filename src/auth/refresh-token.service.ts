import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminPrismaService } from '../admin-prisma.service';
import * as crypto from 'crypto';

const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const REFRESH_TOKEN_FAMILY_LIMIT = 50;

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: AdminPrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async generateRefreshToken(
    userId: string,
    ip?: string,
    userAgent?: string,
    existingFamily?: string,
  ): Promise<{ refreshToken: string; expiresAt: Date }> {
    const family = existingFamily || crypto.randomUUID();
    const rawToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 86400000);

    await this.prisma.refreshToken.create({
      data: {
        token: tokenHash,
        userId,
        family,
        ip: ip || null,
        userAgent: userAgent || null,
        expiresAt,
      },
    });

    const familyCount = await this.prisma.refreshToken.count({
      where: { family, revokedAt: null },
    });
    if (familyCount > REFRESH_TOKEN_FAMILY_LIMIT) {
      await this.prisma.refreshToken.updateMany({
        where: { family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`Refresh token family ${family} exceeded limit, all revoked`);
    }

    const refreshToken = this.jwtService.sign(
      { sub: userId, family, type: 'refresh' },
      { expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d` },
    );

    return { refreshToken, expiresAt };
  }

  async rotateRefreshToken(
    oldToken: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ refreshToken: string; accessToken: string; expiresAt: Date }> {
    let payload: any;
    try {
      payload = this.jwtService.verify(oldToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const tokenHash = crypto.createHash('sha256').update(oldToken).digest('hex');

    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt) {
      this.logger.warn(`Refresh token reuse detected for family ${payload.family}, revoking entire family`);
      await this.prisma.refreshToken.updateMany({
        where: { family: payload.family },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const { refreshToken: newRefreshToken, expiresAt } = await this.generateRefreshToken(
      stored.userId,
      ip,
      userAgent,
      payload.family,
    );

    const accessToken = this.jwtService.sign({
      sub: stored.user.id,
      email: stored.user.email,
      name: stored.user.displayName,
      role: stored.user.platformRole,
      companyId: stored.user.companyId,
    });

    return { refreshToken: newRefreshToken, accessToken, expiresAt };
  }

  async revokeRefreshToken(token: string): Promise<void> {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.type !== 'refresh') return;
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await this.prisma.refreshToken.updateMany({
        where: { token: tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Token invalid or expired, nothing to revoke
    }
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(family: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async cleanupExpiredTokens(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
