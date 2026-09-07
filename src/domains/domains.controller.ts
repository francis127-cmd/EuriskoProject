import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { DomainVerificationService } from './domain-verification.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { IsNotEmpty, IsString } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { PlatformRole } from '@prisma/client';

class RequestVerificationDto {
  @IsString()
  @IsNotEmpty()
  domain: string;
}

@Controller('domains')
export class DomainsController {
  constructor(private readonly domainService: DomainVerificationService) {}

  @Post('verify-request')
  @Roles(PlatformRole.SYSTEM_ADMIN)
  @HttpCode(HttpStatus.OK)
  async requestVerification(
    @CurrentUser() user: AuthUser,
    @Body() dto: RequestVerificationDto,
  ) {
    return this.domainService.requestVerification(user.companyId, dto.domain);
  }

  @Post('verify')
  @Roles(PlatformRole.SYSTEM_ADMIN)
  @HttpCode(HttpStatus.OK)
  async verifyDomain(
    @CurrentUser() user: AuthUser,
    @Body() dto: RequestVerificationDto,
  ) {
    return this.domainService.verifyDomain(user.companyId, dto.domain);
  }

  @Get('status')
  @Roles(PlatformRole.SYSTEM_ADMIN)
  async getStatus(@CurrentUser() user: AuthUser) {
    return this.domainService.getVerificationStatus(user.companyId);
  }
}
