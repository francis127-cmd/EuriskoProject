import { Controller, Post, Get, Patch, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { IsString, IsEmail, MinLength, IsOptional } from 'class-validator';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PlatformRole } from '@prisma/client';

class RegisterCompanyDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  slug!: string;

  @IsString()
  @MinLength(3)
  domain!: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(2)
  adminName!: string;

  @IsOptional()
  @IsString()
  googleClientId?: string;
}

class UpdateCompanyDto {
  @IsString()
  @MinLength(2)
  name!: string;
}

class UpdateSsoDto {
  @IsOptional()
  @IsString()
  googleClientId?: string;

  @IsOptional()
  @IsString()
  domain?: string;
}

@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new company' })
  @ApiResponse({ status: 201, description: 'Company and admin created.' })
  register(@Body() dto: RegisterCompanyDto) {
    return this.companiesService.registerCompany(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all active companies' })
  list() {
    return this.companiesService.listCompanies();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get company by slug' })
  getBySlug(@Param('slug') slug: string) {
    return this.companiesService.getCompanyBySlug(slug);
  }

  @Get(':id/settings')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(PlatformRole.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Get company SSO settings (admin only)' })
  async getSettings(@Param('id') id: string, @Request() req: any) {
    if (req.user.companyId !== id) {
      throw new Error('Cannot view settings for another company');
    }
    return this.companiesService.getCompanyById(id);
  }

  @Patch(':id')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(PlatformRole.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Update company name (admin only)' })
  async update(@Param('id') id: string, @Body() dto: UpdateCompanyDto, @Request() req: any) {
    if (req.user.companyId !== id) {
      throw new Error('Cannot update another company');
    }
    return this.companiesService.updateCompany(id, dto.name);
  }

  @Patch(':id/sso')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(PlatformRole.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Update company SSO settings (admin only)' })
  async updateSso(@Param('id') id: string, @Body() dto: UpdateSsoDto, @Request() req: any) {
    if (req.user.companyId !== id) {
      throw new Error('Cannot update settings for another company');
    }
    return this.companiesService.updateCompanySso(id, dto);
  }
}
