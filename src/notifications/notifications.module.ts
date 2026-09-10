import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AdminPrismaService } from '../admin-prisma.service';

@Module({
  providers: [NotificationsService, AdminPrismaService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
