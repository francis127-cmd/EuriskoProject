import { Controller, Get, Param } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.departmentsService.listActive(user);
  }

  @Get('me/memberships')
  async myMemberships(@CurrentUser() user: AuthUser) {
    return this.departmentsService.getMemberships(user);
  }
}
