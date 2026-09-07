import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto, UpdateRequestStatusDto } from './requests.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('department') department?: string,
    @Query('view') view?: string,
  ) {
    if (view === 'claimed') {
      return this.requestsService.listClaimed(user);
    }
    if (department) {
      return this.requestsService.listDeptQueue(user, department);
    }
    return this.requestsService.listMyRequests(user);
  }

  @Get('stats')
  async stats(@CurrentUser() user: AuthUser) {
    return this.requestsService.getStats(user);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requestsService.getRequest(id, user);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateRequestDto) {
    return this.requestsService.createRequest(user, dto);
  }

  @Post(':id/claim')
  async claim(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requestsService.claimRequest(id, user);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateRequestStatusDto,
  ) {
    return this.requestsService.updateStatus(id, user, dto);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requestsService.cancelRequest(id, user);
  }
}
