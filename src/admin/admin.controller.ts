import { Controller, Get, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AuthUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('admin')
@UseGuards(JwtGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers(@CurrentUser() user: AuthUser) {
    return this.adminService.listUsers(user);
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: { departmentCode?: string; departmentRole?: string; platformRole?: string }, @CurrentUser() user: AuthUser) {
    return this.adminService.updateUser(id, dto, user);
  }

  @Delete('users/:id')
  deactivateUser(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.adminService.deactivateUser(id, user);
  }

  @Get('departments')
  listDepartments(@CurrentUser() user: AuthUser) {
    return this.adminService.listDepartments(user);
  }
}
