import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaService } from './prisma.service';
import { AuthModule } from './auth/auth.module';
import { DepartmentsModule } from './departments/departments.module';
import { RequestsModule } from './requests/requests.module';
import { DocumentsModule } from './documents/documents.module';
import { CatalogModule } from './catalog/catalog.module';
import { RetentionModule } from './retention/retention.module';
import { AdminModule } from './admin/admin.module';
import { InfraExceptionFilter } from './common/infra-exception.filter';

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
  ],
  providers: [
    PrismaService,
    { provide: APP_FILTER, useClass: InfraExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
