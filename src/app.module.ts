import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScopedPrismaService } from './scoped-prisma.service';
import { AdminPrismaService } from './admin-prisma.service';
import { AuthModule } from './auth/auth.module';
import { DepartmentsModule } from './departments/departments.module';
import { RequestsModule } from './requests/requests.module';
import { DocumentsModule } from './documents/documents.module';
import { CatalogModule } from './catalog/catalog.module';
import { RetentionModule } from './retention/retention.module';
import { AdminModule } from './admin/admin.module';
import { CompaniesModule } from './companies/companies.module';
import { DomainsModule } from './domains/domains.module';
import { ScimModule } from './scim/scim.module';
import { InfraExceptionFilter } from './common/infra-exception.filter';
import { AppController } from './app.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 30 }],
      getTracker: (req: Record<string, unknown>) =>
        ((req['headers'] as Record<string, unknown> | undefined)?.['authorization'] as string) ??
        (req['ip'] as string) ??
        'anonymous',
    }),
    AuthModule,
    DepartmentsModule,
    RequestsModule,
    DocumentsModule,
    CatalogModule,
    RetentionModule,
    AdminModule,
    CompaniesModule,
    DomainsModule,
    ScimModule,
  ],
  controllers: [AppController],
  providers: [
    ScopedPrismaService,
    AdminPrismaService,
    { provide: APP_FILTER, useClass: InfraExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [ScopedPrismaService, AdminPrismaService],
})
export class AppModule {}
