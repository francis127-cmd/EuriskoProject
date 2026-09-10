import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus, Req, NotFoundException } from '@nestjs/common';
import { OidcFederationService } from './oidc-federation.service';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.service';
import { Public } from './public.decorator';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsString, IsOptional, IsBoolean } from 'class-validator';
import { Roles } from './roles.decorator';
import { PlatformRole } from '@prisma/client';
import { AdminPrismaService } from '../admin-prisma.service';

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

class OidcAuthorizeDto {
  @IsString()
  @IsNotEmpty()
  companySlug: string;

  @IsString()
  @IsNotEmpty()
  providerName: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;
}

class OidcCallbackDto {
  @IsString()
  @IsNotEmpty()
  companySlug: string;

  @IsString()
  @IsNotEmpty()
  providerName: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  codeVerifier: string;

  @IsString()
  @IsNotEmpty()
  state: string;
}

@Controller('oidc')
export class OidcFederationController {
  constructor(
    private readonly oidcService: OidcFederationService,
    private readonly adminPrisma: AdminPrismaService,
  ) {}

  private async resolveCompanyId(companySlug: string): Promise<string> {
    const company = await this.adminPrisma.company.findUnique({ where: { slug: companySlug } });
    if (!company) throw new NotFoundException('Company not found');
    return company.id;
  }

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
    return this.oidcService.discoverProviders(await this.resolveCompanyId(companySlug));
  }

  @Public()
  @Post('authorize')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async initiateLogin(@Body() body: OidcAuthorizeDto) {
    return this.oidcService.initiateOidcLogin(
      await this.resolveCompanyId(body.companySlug),
      body.providerName,
      body.redirectUri,
    );
  }

  @Public()
  @Post('callback')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async handleCallback(@Body() body: OidcCallbackDto, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    return this.oidcService.handleOidcCallback(
      await this.resolveCompanyId(body.companySlug),
      body.providerName,
      body.code,
      body.codeVerifier,
      body.state,
      ip,
      userAgent,
    );
  }
}
