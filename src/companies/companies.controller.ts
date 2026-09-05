import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { IsString, IsEmail, MinLength } from 'class-validator';

class RegisterCompanyDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  slug!: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(2)
  adminName!: string;
}

@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  // NOTE: Intentionally unauthenticated — this is the entry point for new companies.
  // The first admin needs to register without an existing account.
  // In production, restrict by IP whitelist or add CAPTCHA/rate-limiting.
  @Post('register')
  @ApiOperation({ summary: 'Register a new company and provision its default departments and admin' })
  @ApiResponse({ status: 201, description: 'Company and admin created successfully.' })
  register(@Body() dto: RegisterCompanyDto) {
    return this.companiesService.registerCompany(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all active companies' })
  list() {
    return this.companiesService.listCompanies();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get company information by slug' })
  getBySlug(@Param('slug') slug: string) {
    return this.companiesService.getCompanyBySlug(slug);
  }
}
