import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { OidcFederationService } from './oidc-federation.service';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.service';
import { Public } from './public.decorator';
import { IsNotEmpty, IsString, IsOptional, IsBoolean } from 'class-validator';
import { Roles } from './roles.decorator';
import { PlatformRole } from '@prisma/client';

class CreateOidcProviderDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  issuer: string;

  @IsString()
  @IsNotEmpty()
  clientId: string;

  @IsString()
  @IsNotEmpty()
  clientSecret: string;

  @IsString()
  @IsNotEmpty()
  discoveryUrl: string;

  @IsString()
  @IsNotEmpty()
  redirectUri: string;

  @IsOptional()
  @IsString()
  scopes?: string;

  @IsOptional()
  @IsString()
  iconUrl?: string;
}

class UpdateOidcProviderDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;

  @IsOptional()
  @IsString()
  scopes?: string;

  @IsOptional()
  @IsString()
  iconUrl?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

@Controller('oidc')
export class OidcFederationController {
  constructor(private readonly oidcService: OidcFederationService) {}

  @Get('providers')
  @Roles(PlatformRole.SYSTEM_ADMIN)
  async listProviders(@CurrentUser() user: AuthUser) {
    return this.oidcService.listProviders(user.companyId);
  }

  @Post('providers')
  @Roles(PlatformRole.SYSTEM_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createProvider(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateOidcProviderDto,
  ) {
    return this.oidcService.createProvider(user.companyId, dto);
  }

  @Patch('providers/:id')
  @Roles(PlatformRole.SYSTEM_ADMIN)
  async updateProvider(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateOidcProviderDto,
  ) {
    return this.oidcService.updateProvider(user.companyId, id, dto);
  }

  @Delete('providers/:id')
  @Roles(PlatformRole.SYSTEM_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProvider(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.oidcService.deleteProvider(user.companyId, id);
  }

  @Public()
  @Get('discover/:companySlug')
  async discoverProviders(@Param('companySlug') companySlug: string) {
    const { AdminPrismaService } = await import('../admin-prisma.service');
    const prisma = new AdminPrismaService();
    const company = await prisma.company.findUnique({ where: { slug: companySlug } });
    if (!company) return { providers: [] };
    return this.oidcService.discoverProviders(company.id);
  }

  @Post('authorize')
  @Roles(PlatformRole.SYSTEM_ADMIN, PlatformRole.EMPLOYEE)
  @HttpCode(HttpStatus.OK)
  async initiateLogin(
    @CurrentUser() user: AuthUser,
    @Body() body: { providerName: string },
  ) {
    return this.oidcService.initiateOidcLogin(user.companyId, body.providerName);
  }

  @Public()
  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async handleCallback(
    @Body() body: { companyId: string; providerName: string; code: string; state: string },
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    return this.oidcService.handleOidcCallback(
      body.companyId,
      body.providerName,
      body.code,
      body.state,
      ip,
      userAgent,
    );
  }
}
