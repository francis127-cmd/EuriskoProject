import { Controller, Get, Patch, Param, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async listMine(@CurrentUser() user: AuthUser) {
    return this.notifications.listForUser(user.sub);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUser) {
    return { count: await this.notifications.unreadCount(user.sub) };
  }

  @Patch('read-all')
  async readAll(@CurrentUser() user: AuthUser) {
    return { updated: await this.notifications.markAllRead(user.sub) };
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const updated = await this.notifications.markRead(user.sub, id);
    if (!updated) throw new NotFoundException('Notification not found');
    return { read: true };
  }
}
