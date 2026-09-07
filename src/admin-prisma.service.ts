import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Plain PrismaClient for system-level queries that bypass tenant scoping.
 * Used by AuthService, InvitationService, CompaniesService, and RetentionService
 * for operations that span all companies or operate before authentication.
 */
@Injectable()
export class AdminPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminPrismaService.name);

  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL']! });
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('AdminPrisma connected to PostgreSQL');
    } catch (e) {
      this.logger.error('AdminPrisma failed to connect', (e as Error).message);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
