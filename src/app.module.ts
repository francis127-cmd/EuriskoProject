import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
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
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { CompaniesModule } from './companies/companies.module';
import { DomainsModule } from './domains/domains.module';
import { ScimModule } from './scim/scim.module';
import { LegalModule } from './legal/legal.module';
import { InfraExceptionFilter } from './common/infra-exception.filter';
import { TenantMiddleware } from './tenant.middleware';
import { AppController } from './app.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      // Pilot tuning: per-user buckets (tracker keys on the JWT when present),
      // so 100/min is generous for humans, still hostile to naive floods.
      // Revisit with login lockouts before large-scale rollout.
      throttlers: [{ ttl: 60_000, limit: 100 }],
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
    NotificationsModule,
    AdminModule,
    CompaniesModule,
    DomainsModule,
    ScimModule,
    LegalModule,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
