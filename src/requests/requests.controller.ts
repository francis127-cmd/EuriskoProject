import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { RequestsService } from './requests.service';
import { CreateRequestDto, UpdateRequestStatusDto } from './requests.types';

@ApiTags('requests')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new request' })
  create(@Body() dto: CreateRequestDto, @CurrentUser() user: AuthUser) {
    return this.requestsService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List requests (employee: own, dept member: dept queue)' })
  list(@CurrentUser() user: AuthUser, @Query('department') department?: string) {
    if (department) {
      return this.requestsService.listDepartmentQueue(user, department);
    }
    return this.requestsService.listEmployee(user);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get request statistics' })
  stats(@CurrentUser() user: AuthUser) {
    return this.requestsService.getStats(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single request' })
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requestsService.getOne(id, user);
  }

  @Post(':id/claim')
  @HttpCode(200)
  @ApiOperation({ summary: 'Claim a PENDING request (department agent)' })
  claim(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requestsService.claim(id, user);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update request status (claim/complete/reject)' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRequestStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requestsService.updateStatus(id, dto, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a PENDING request (employee only)' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requestsService.cancel(id, user);
  }
}
