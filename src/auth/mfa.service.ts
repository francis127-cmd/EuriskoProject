import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
import * as crypto from 'crypto';
import { AdminPrismaService } from '../admin-prisma.service';

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(private readonly prisma: AdminPrismaService) {}

  async generateMfaSecret(userId: string, email: string, companyName: string): Promise<{
    secret: string;
    otpauthUrl: string;
    backupCodes: string[];
  }> {
    const totp = new OTPAuth.TOTP({
      issuer: companyName,
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: new OTPAuth.Secret({ size: 20 }),
    });

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      crypto.randomBytes(BACKUP_CODE_LENGTH).toString('hex').toUpperCase(),
    );

    const hashedBackupCodes = backupCodes.map((code) =>
      crypto.createHash('sha256').update(code).digest('hex'),
    );

    await this.prisma.mfaSecret.upsert({
      where: { userId },
      create: {
        userId,
        secret: totp.secret.base32,
        enabled: false,
        backupCodes: JSON.stringify(hashedBackupCodes),
      },
      update: {
        secret: totp.secret.base32,
        enabled: false,
        backupCodes: JSON.stringify(hashedBackupCodes),
      },
    });

    this.logger.log(`MFA secret generated for user ${userId}`);

    return {
      secret: totp.secret.base32,
      otpauthUrl: totp.toString(),
      backupCodes,
    };
  }

  async verifyAndEnableMfa(userId: string, token: string): Promise<boolean> {
    const mfaRecord = await this.prisma.mfaSecret.findUnique({ where: { userId } });
    if (!mfaRecord) throw new BadRequestException('MFA setup not initiated');

    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(mfaRecord.secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const delta = totp.validate({ token, window: 2 });
    if (delta === null) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    await this.prisma.mfaSecret.update({
      where: { userId },
      data: { enabled: true },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    this.logger.log(`MFA enabled for user ${userId}`);
    return true;
  }

  async verifyMfaToken(userId: string, token: string): Promise<boolean> {
    const mfaRecord = await this.prisma.mfaSecret.findUnique({ where: { userId } });
    if (!mfaRecord || !mfaRecord.enabled) {
      return true;
    }

    const backupCodes: string[] = JSON.parse(mfaRecord.backupCodes);
    const inputHash = crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');
    const backupIndex = backupCodes.indexOf(inputHash);

    if (backupIndex !== -1) {
      const updatedCodes = [...backupCodes];
      updatedCodes.splice(backupIndex, 1);
      await this.prisma.mfaSecret.update({
        where: { userId },
        data: { backupCodes: JSON.stringify(updatedCodes) },
      });
      this.logger.log(`MFA backup code used for user ${userId}, remaining: ${updatedCodes.length}`);
      return true;
    }

    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(mfaRecord.secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const delta = totp.validate({ token, window: 2 });
    if (delta === null) {
      this.logger.warn(`MFA verification failed for user ${userId}`);
      return false;
    }

    return true;
  }

  async disableMfa(userId: string): Promise<void> {
    await this.prisma.mfaSecret.delete({ where: { userId } }).catch(() => {});
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false },
    });
    this.logger.log(`MFA disabled for user ${userId}`);
  }

  async getMfaStatus(userId: string): Promise<{ enabled: boolean; backupCodesRemaining: number }> {
    const mfaRecord = await this.prisma.mfaSecret.findUnique({ where: { userId } });
    if (!mfaRecord || !mfaRecord.enabled) {
      return { enabled: false, backupCodesRemaining: 0 };
    }
    const backupCodes: string[] = JSON.parse(mfaRecord.backupCodes);
    return { enabled: true, backupCodesRemaining: backupCodes.length };
  }

  async regenerateBackupCodes(userId: string): Promise<string[]> {
    const mfaRecord = await this.prisma.mfaSecret.findUnique({ where: { userId } });
    if (!mfaRecord || !mfaRecord.enabled) {
      throw new BadRequestException('MFA is not enabled');
    }

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      crypto.randomBytes(BACKUP_CODE_LENGTH).toString('hex').toUpperCase(),
    );

    const hashedBackupCodes = backupCodes.map((code) =>
      crypto.createHash('sha256').update(code).digest('hex'),
    );

    await this.prisma.mfaSecret.update({
      where: { userId },
      data: { backupCodes: JSON.stringify(hashedBackupCodes) },
    });

    return backupCodes;
  }
}
