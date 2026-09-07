import { Controller, Post, Body, Get, Param, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.service';
import { Roles } from './roles.decorator';
import { PlatformRole } from '@prisma/client';

class DiscoverDto {
  @IsEmail()
  email: string;
}

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @IsString()
  companySlug?: string;
}

class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  companySlug?: string;
}

class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  idToken: string;
}

class AcceptInviteDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @MinLength(6)
  password: string;
}

class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

class MfaChallengeDto {
  @IsString()
  @IsNotEmpty()
  mfaToken: string;

  @IsString()
  @IsNotEmpty()
  mfaCode: string;
}

class MfaSetupDto {}

class MfaVerifyDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

class MfaDisableDto {}

class MfaRegenerateBackupCodesDto {}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
  ) {}

  @Post('discover')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async discover(@Body() dto: DiscoverDto) {
    return this.authService.discover(dto.email);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    return this.authService.loginPassword(dto.email, dto.password, dto.companySlug, ip, userAgent);
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  async register(@Body() dto: RegisterDto, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    return this.authService.registerPassword(dto, ip, userAgent);
  }

  @Post('google')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async googleLogin(@Body() dto: GoogleLoginDto, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    return this.authService.loginGoogle(dto.idToken, ip, userAgent);
  }

  @Post('accept-invite')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async acceptInvite(@Body() dto: AcceptInviteDto, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    return this.authService.acceptInvite(dto.token, dto.password, ip, userAgent);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    return this.authService.refreshTokens(dto.refreshToken, ip, userAgent);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: LogoutDto, @CurrentUser() user: AuthUser) {
    await this.authService.logout(dto.refreshToken);
    return { success: true };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.authService.logoutAll(user.sub);
    return { success: true };
  }

  @Post('mfa/challenge')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async mfaChallenge(@Body() dto: MfaChallengeDto, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    return this.authService.completeMfaChallenge(dto.mfaToken, dto.mfaCode, ip, userAgent);
  }

  @Post('mfa/setup')
  @Roles(PlatformRole.SYSTEM_ADMIN, PlatformRole.EMPLOYEE)
  @HttpCode(HttpStatus.OK)
  async mfaSetup(@CurrentUser() user: AuthUser) {
    const company = await this.authService.verifyToken('').then(() => null).catch(() => null);
    return this.mfaService.generateMfaSecret(user.sub, user.email, user.name || 'Internal Hub');
  }

  @Post('mfa/verify')
  @Roles(PlatformRole.SYSTEM_ADMIN, PlatformRole.EMPLOYEE)
  @HttpCode(HttpStatus.OK)
  async mfaVerify(@CurrentUser() user: AuthUser, @Body() dto: MfaVerifyDto) {
    return this.mfaService.verifyAndEnableMfa(user.sub, dto.token);
  }

  @Post('mfa/disable')
  @Roles(PlatformRole.SYSTEM_ADMIN, PlatformRole.EMPLOYEE)
  @HttpCode(HttpStatus.OK)
  async mfaDisable(@CurrentUser() user: AuthUser) {
    await this.mfaService.disableMfa(user.sub);
    return { success: true };
  }

  @Get('mfa/status')
  @Roles(PlatformRole.SYSTEM_ADMIN, PlatformRole.EMPLOYEE)
  async mfaStatus(@CurrentUser() user: AuthUser) {
    return this.mfaService.getMfaStatus(user.sub);
  }

  @Post('mfa/regenerate-backup-codes')
  @Roles(PlatformRole.SYSTEM_ADMIN, PlatformRole.EMPLOYEE)
  @HttpCode(HttpStatus.OK)
  async mfaRegenerateBackupCodes(@CurrentUser() user: AuthUser) {
    const backupCodes = await this.mfaService.regenerateBackupCodes(user.sub);
    return { backupCodes };
  }

  @Get('invitations/:token')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async validateInviteToken(@Param('token') token: string) {
    return this.authService.validateInviteToken(token);
  }
}
