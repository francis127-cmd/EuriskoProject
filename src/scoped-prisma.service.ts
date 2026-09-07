import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { TenantContext } from './tenant-context';

/**
 * Enterprise Scoped Prisma Client
 *
 * Automatically injects tenant isolation constraints into all Prisma operations.
 * Covers both direct companyId models and relational child models.
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
    const DIRECT_TENANT_MODELS = new Set(['User', 'Department', 'Invitation']);
    const RELATIONAL_TENANT_MODELS = new Set([
      'Request',
      'Document',
      'DepartmentMember',
      'RequestType',
    ]);
    const base = this._baseClient;

    this._scopedClient = base.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }: any) {
            const tenant = TenantContext.getStore();
            const cid = tenant?.companyId;

            // If no company context (e.g. system background worker, registration), pass through
            if (!cid || !model) {
              return query(args);
            }

            const withTenant = (where: any, tenantWhere: any) =>
              where ? { AND: [where, tenantWhere] } : tenantWhere;

            // Direct companyId models: User, Department, Invitation
            if (DIRECT_TENANT_MODELS.has(model)) {
              if (['findMany', 'findFirst', 'count', 'aggregate'].includes(operation)) {
                args.where = withTenant(args.where, { companyId: cid });
                return query(args);
              }

              if (operation === 'findUnique') {
                const result = await query(args);
                if (result && result.companyId && result.companyId !== cid) {
                  throw new Error('Tenant isolation violation: record belongs to another company');
                }
                return result;
              }

              if (operation === 'create') {
                if (!args.data.companyId) {
                  args.data = { ...args.data, companyId: cid };
                } else if (args.data.companyId !== cid) {
                  throw new Error('Tenant isolation violation: cannot create record for another company');
                }
                return query(args);
              }

              if (['update', 'updateMany', 'delete', 'deleteMany', 'upsert'].includes(operation)) {
                args.where = withTenant(args.where, { companyId: cid });
                if (operation === 'upsert' && args.create && !args.create.companyId) {
                  args.create = { ...args.create, companyId: cid };
                }
                return query(args);
              }
            }

            // Relational models: Request, Document, DepartmentMember, RequestType
            if (RELATIONAL_TENANT_MODELS.has(model)) {
              if (model === 'Request') {
                if (['findMany', 'findFirst', 'count', 'aggregate'].includes(operation)) {
                  args.where = withTenant(args.where, { department: { companyId: cid } });
                  return query(args);
                }
                if (['update', 'updateMany', 'delete', 'deleteMany'].includes(operation)) {
                  args.where = withTenant(args.where, { department: { companyId: cid } });
                  return query(args);
                }
                if (operation === 'create' && args.data?.departmentId) {
                  const department = await base.department.findFirst({ where: { id: args.data.departmentId, companyId: cid }, select: { id: true } });
                  if (!department) throw new Error('Tenant isolation violation: invalid department');
                }
              }

              if (model === 'Document') {
                if (['findMany', 'findFirst', 'count', 'aggregate', 'update', 'updateMany', 'delete', 'deleteMany'].includes(operation)) {
                  args.where = withTenant(args.where, { request: { department: { companyId: cid } } });
                  return query(args);
                }
                if (operation === 'create' && args.data?.requestId) {
                  const request = await base.request.findFirst({ where: { id: args.data.requestId, department: { companyId: cid } }, select: { id: true } });
                  if (!request) throw new Error('Tenant isolation violation: invalid request');
                }
              }

              if (model === 'DepartmentMember' || model === 'RequestType') {
                if (['findMany', 'findFirst', 'count', 'aggregate', 'update', 'updateMany', 'delete', 'deleteMany'].includes(operation)) {
                  args.where = withTenant(args.where, { department: { companyId: cid } });
                  return query(args);
                }
                if (operation === 'create' && args.data?.departmentId) {
                  const department = await base.department.findFirst({ where: { id: args.data.departmentId, companyId: cid }, select: { id: true } });
                  if (!department) throw new Error('Tenant isolation violation: invalid department');
                }
              }
            }

            return query(args);
          },
        },
      },
    });

    this.logger.log('Strict multi-tenant scoping extensions installed');
  }

  // Delegate PrismaClient accessors to scoped client
  get user() { return this.client.user; }
  get company() { return this.client.company; }
  get department() { return this.client.department; }
  get requestType() { return this.client.requestType; }
  get departmentMember() { return this.client.departmentMember; }
  get request() { return this.client.request; }
  get document() { return this.client.document; }
  get auditLog() { return this.client.auditLog; }
  get invitation() { return this.client.invitation; }
  get notificationEvent() { return this.client.notificationEvent; }

  async $connect() { return this._baseClient.$connect(); }
  async $disconnect() { return this._baseClient.$disconnect(); }
  async $transaction(...args: any[]) { return (this.client as any).$transaction(...args); }
}
