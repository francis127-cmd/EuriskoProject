import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { AdminPrismaService } from '../admin-prisma.service';
import * as crypto from 'crypto';
import * as dns from 'dns';

const VERIFICATION_TOKEN_PREFIX = 'eurisko-domain-verify=';
const VERIFICATION_EXPIRY_HOURS = 24;

@Injectable()
export class DomainVerificationService {
  private readonly logger = new Logger(DomainVerificationService.name);

  constructor(private readonly prisma: AdminPrismaService) {}

  async requestVerification(companyId: string, domain: string): Promise<{
    token: string;
    dnsRecord: { type: string; name: string; value: string };
    expiresAt: Date;
  }> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');

    const normalizedDomain = domain.toLowerCase().trim();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 3600000);

    await this.prisma.domainVerification.create({
      data: {
        companyId,
        domain: normalizedDomain,
        token,
        expiresAt,
      },
    });

    this.logger.log(`Domain verification requested: ${normalizedDomain} for company ${company.slug}`);

    return {
      token,
      dnsRecord: {
        type: 'TXT',
        name: `_eurisko-verify.${normalizedDomain}`,
        value: `${VERIFICATION_TOKEN_PREFIX}${token}`,
      },
      expiresAt,
    };
  }

  async verifyDomain(companyId: string, domain: string): Promise<{ verified: boolean; domain: string }> {
    const verification = await this.prisma.domainVerification.findFirst({
      where: { companyId, domain: domain.toLowerCase().trim(), verified: false },
    });

    if (!verification) {
      throw new NotFoundException('No pending verification found for this domain');
    }

    if (verification.expiresAt < new Date()) {
      throw new BadRequestException('Verification token has expired. Request a new one.');
    }

    const dnsName = `_eurisko-verify.${verification.domain}`;
    const expectedValue = `${VERIFICATION_TOKEN_PREFIX}${verification.token}`;

    const records = await this.resolveTxt(dnsName);

    if (records.some((r) => r === expectedValue)) {
      await this.prisma.domainVerification.update({
        where: { id: verification.id },
        data: { verified: true, verifiedAt: new Date() },
      });

      await this.prisma.company.update({
        where: { id: companyId },
        data: { domain: verification.domain },
      });

      this.logger.log(`Domain verified: ${verification.domain} for company ${companyId}`);

      return { verified: true, domain: verification.domain };
    }

    return { verified: false, domain: verification.domain };
  }

  async getVerificationStatus(companyId: string): Promise<{
    domain: string | null;
    pending: { domain: string; expiresAt: Date }[];
    verified: string[];
  }> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');

    const pending = await this.prisma.domainVerification.findMany({
      where: { companyId, verified: false, expiresAt: { gt: new Date() } },
      select: { domain: true, expiresAt: true },
    });

    const verifiedRecords = await this.prisma.domainVerification.findMany({
      where: { companyId, verified: true },
      select: { domain: true },
    });

    return {
      domain: company.domain,
      pending: pending.map((p) => ({ domain: p.domain, expiresAt: p.expiresAt })),
      verified: verifiedRecords.map((v) => v.domain),
    };
  }

  private resolveTxt(hostname: string): Promise<string[]> {
    return new Promise((resolve) => {
      dns.resolveTxt(hostname, (err, records) => {
        if (err) {
          resolve([]);
          return;
        }
        resolve(records.map((r) => r.join('')));
      });
    });
  }
}
