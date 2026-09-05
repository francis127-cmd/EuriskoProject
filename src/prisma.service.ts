import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL']! });
    super({ adapter });
  }

  // When the Postgres backend is unreachable every query throws; callers
  // translate that into a 503 so the client can surface a maintenance screen.
  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Connected to PostgreSQL');
    } catch (e) {
      this.logger.error('Failed to connect to PostgreSQL', (e as Error).message);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
