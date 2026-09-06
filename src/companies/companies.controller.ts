import { Controller, Post, Get, Patch, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { IsString, IsEmail, MinLength, IsOptional } from 'class-validator';

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

  @Patch(':id')
  @ApiOperation({ summary: 'Update company name' })
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.updateCompany(id, dto.name);
  }

  @Patch(':id/sso')
  @ApiOperation({ summary: 'Update company SSO settings (admin only)' })
  updateSso(@Param('id') id: string, @Body() dto: UpdateSsoDto) {
    return this.companiesService.updateCompanySso(id, dto);
  }
}
