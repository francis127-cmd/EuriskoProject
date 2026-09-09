import { Controller, Get, Patch, Post, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { PlatformRole } from '@prisma/client';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, IsBoolean, IsNumber, Min, Max } from 'class-validator';

class RegisterCompanyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  authMode?: string;

  @IsOptional()
  @IsString()
  googleClientId?: string;

  @IsEmail()
  adminEmail: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  adminPassword?: string;
}

class UpdateCompanyDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

class UpdateSsoDto {
  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  googleClientId?: string;

  @IsOptional()
  @IsString()
  authMode?: string;

  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(90)
  refreshTokenExpiryDays?: number;

  @IsOptional()
  @IsString()
  oidcClientId?: string;

  @IsOptional()
  @IsString()
  oidcClientSecret?: string;

  @IsOptional()
  @IsString()
  oidcDiscoveryUrl?: string;

  @IsOptional()
  @IsString()
  oidcIssuer?: string;

  @IsOptional()
  @IsString()
  samlMetadataUrl?: string;

  @IsOptional()
  @IsString()
  samlCertificate?: string;

  @IsOptional()
  @IsString()
  samlCallbackUrl?: string;
}

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterCompanyDto) {
    return this.companiesService.registerCompany(dto);
  }

  @Get(':id/settings')
  @Roles(PlatformRole.SYSTEM_ADMIN)
  async getSettings(@Param('id') id: string) {
    return this.companiesService.getCompanySettings(id);
  }

  @Patch(':id')
  @Roles(PlatformRole.SYSTEM_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.updateCompany(id, dto.name);
  }

  @Patch(':id/sso')
  @Roles(PlatformRole.SYSTEM_ADMIN)
  async updateSso(@Param('id') id: string, @Body() dto: UpdateSsoDto) {
    return this.companiesService.updateCompanySso(id, dto);
  }
}
