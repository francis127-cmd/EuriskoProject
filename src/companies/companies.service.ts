import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { AdminPrismaService } from '../admin-prisma.service';

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(private readonly prisma: AdminPrismaService) {}

  async registerCompany(data: {
    name: string;
    slug: string;
    domain?: string;
    authMode?: string;
    googleClientId?: string;
    adminEmail: string;
    adminPassword: string;
  }) {
    const existing = await this.prisma.company.findUnique({ where: { slug: data.slug } });
    if (existing) {
      throw new BadRequestException('Company slug already taken');
    }

    const company = await this.prisma.company.create({
      data: {
        name: data.name,
        slug: data.slug,
        domain: data.domain,
        authMode: data.authMode || 'PASSWORD',
        googleClientId: data.googleClientId,
      },
    });

    this.logger.log(`Company registered: ${company.name} (${company.slug})`);

    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
    };
  }

  async getCompanyById(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  async getCompanySettings(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      domain: company.domain || '',
      authMode: company.authMode,
      ssoProvider: company.ssoProvider || '',
      googleClientId: company.googleClientId || '',
    };
  }

  async updateCompanySso(
    companyId: string,
    dto: { domain?: string; googleClientId?: string; authMode?: string },
  ) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...(dto.domain !== undefined && { domain: dto.domain }),
        ...(dto.googleClientId !== undefined && { googleClientId: dto.googleClientId }),
        ...(dto.authMode !== undefined && { authMode: dto.authMode }),
      },
    });

    this.logger.log(`Company SSO config updated: ${updated.slug}`);

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      domain: updated.domain || '',
      authMode: updated.authMode,
      ssoProvider: updated.ssoProvider || '',
      googleClientId: updated.googleClientId || '',
    };
  }

  async updateCompany(companyId: string, name: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: { name },
    });

    return { id: updated.id, name: updated.name, slug: updated.slug };
  }
}
