import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { AdminPrismaService } from '../admin-prisma.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, AdminPrismaService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
