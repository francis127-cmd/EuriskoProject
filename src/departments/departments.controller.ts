import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { DepartmentsService } from './departments.service';

@ApiTags('departments')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List active departments with their request types' })
  list(@CurrentUser() user: AuthUser) {
    return this.departmentsService.listActive(user.companyId);
  }

  @Get(':code')
  @ApiOperation({ summary: 'Get a department by code' })
  get(@Param('code') code: string, @CurrentUser() user: AuthUser) {
    return this.departmentsService.getDepartment(user.companyId, code);
  }

  @Get('me/memberships')
  @ApiOperation({ summary: 'Get current user department memberships' })
  myMemberships(@CurrentUser() user: AuthUser) {
    return this.departmentsService.getMemberships(user.sub);
  }
}
