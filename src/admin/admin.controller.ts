import { Controller, Get, Patch, Post, Delete, Param, Body, HttpCode, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { IsOptional, IsString } from 'class-validator';

class UpdateUserDto {
  @IsOptional()
  @IsString()
  departmentCode?: string;

  @IsOptional()
  @IsString()
  departmentRole?: string;

  @IsOptional()
  @IsString()
  platformRole?: string;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  async listUsers(@CurrentUser() user: AuthUser) {
    return this.adminService.listUsers(user);
  }

  @Patch('users/:userId')
  async updateUser(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.updateUser(userId, dto, user);
  }

  @Delete('users/:userId')
  async deactivateUser(@Param('userId') userId: string, @CurrentUser() user: AuthUser) {
    return this.adminService.deactivateUser(userId, user);
  }

  @Post('users/:userId/reactivate')
  @HttpCode(200)
  async reactivateUser(@Param('userId') userId: string, @CurrentUser() user: AuthUser) {
    return this.adminService.reactivateUser(userId, user);
  }

  @Get('departments')
  async listDepartments(@CurrentUser() user: AuthUser) {
    return this.adminService.listDepartments(user);
  }
}
