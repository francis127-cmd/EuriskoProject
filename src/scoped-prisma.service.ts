import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { TenantContext } from './tenant-context';

/**
 * Scoped PrismaClient that automatically injects companyId into all queries
 * based on the current request's tenant context (AsyncLocalStorage).
 *
 * Models with a direct `companyId` column get auto-filtered:
 *   User, Department, Invitation
 *
 * Uses Prisma Client Extensions ($extends) instead of middleware for
 * Prisma 7.x compatibility.
 */
@Injectable()
export class ScopedPrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScopedPrismaService.name);
  private _baseClient: PrismaClient;
  private _scopedClient: any;

  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL']! });
    this._baseClient = new PrismaClient({ adapter });
  }

  get client() {
    return this._scopedClient || this._baseClient;
  }

  async onModuleInit() {
    try {
      await this._baseClient.$connect();
      this.logger.log('ScopedPrisma connected to PostgreSQL');
      this.installScoping();
    } catch (e) {
      this.logger.error('ScopedPrisma failed to connect', (e as Error).message);
    }
  }

  async onModuleDestroy() {
    await this._baseClient.$disconnect();
  }

  private installScoping() {
    const TENANT_MODELS = new Set(['User', 'Department', 'Invitation']);
    const base = this._baseClient;

    this._scopedClient = base.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }: any) {
            if (!model || !TENANT_MODELS.has(model)) {
              return query(args);
            }

            const tenant = TenantContext.getStore();
            if (!tenant?.companyId) {
              return query(args);
            }

            const cid = tenant.companyId;

            // READ operations — add companyId filter
            if (['findMany', 'findFirst', 'count', 'aggregate'].includes(operation)) {
              args.where = { ...args.where, companyId: cid };
              return query(args);
            }

            if (operation === 'findUnique') {
              const result = await query(args);
              if (result && result.companyId && result.companyId !== cid) {
                throw new Error('Tenant isolation violation: record belongs to another company');
              }
              return result;
            }

            // CREATE — auto-set and validate companyId
            if (operation === 'create') {
              if (!args.data.companyId) {
                args.data = { ...args.data, companyId: cid };
              } else if (args.data.companyId !== cid) {
                throw new Error('Tenant isolation violation: cannot create record for another company');
              }
              return query(args);
            }

            // UPDATE/DELETE — scope by companyId
            if (['update', 'updateMany', 'delete', 'deleteMany', 'upsert'].includes(operation)) {
              args.where = { ...args.where, companyId: cid };
              return query(args);
            }

            return query(args);
          },
        },
      },
    });

    this.logger.log('Tenant-scoping extensions installed');
  }

  // Delegate all PrismaClient methods to the scoped client
  get user() { return this.client.user; }
  get company() { return this.client.company; }
  get department() { return this.client.department; }
  get requestType() { return this.client.requestType; }
  get departmentMember() { return this.client.departmentMember; }
  get request() { return this.client.request; }
  get document() { return this.client.document; }
  get auditLog() { return this.client.auditLog; }
  get invitation() { return this.client.invitation; }

  async $connect() { return this._baseClient.$connect(); }
  async $disconnect() { return this._baseClient.$disconnect(); }
  async $transaction(...args: any[]) { return (this.client as any).$transaction(...args); }
}
