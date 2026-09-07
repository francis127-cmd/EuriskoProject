import { Controller, Get, Patch, Post, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { Roles } from '../auth/roles.decorator';
import { PlatformRole } from '@prisma/client';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

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

  @IsString()
  @MinLength(6)
  adminPassword: string;
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
}

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

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
