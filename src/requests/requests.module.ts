import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { DepartmentsModule } from '../departments/departments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScopedPrismaService } from '../scoped-prisma.service';

@Module({
  imports: [DepartmentsModule, NotificationsModule],
  controllers: [RequestsController],
  providers: [RequestsService, ScopedPrismaService],
  exports: [RequestsService],
})
export class RequestsModule {}
