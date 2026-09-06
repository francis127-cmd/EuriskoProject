import { Controller, Post, Get, Body, HttpCode, Query, Res, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { IsString, IsEmail, MinLength, IsOptional } from 'class-validator';

class DiscoverDto {
  @IsEmail()
  email!: string;
}

class GoogleLoginDto {
  @IsString()
  idToken!: string;
}

class LoginPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

class RegisterPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

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

class AcceptInviteDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('discover')
  @HttpCode(200)
  @ApiOperation({ summary: 'Discover auth mode for an email address' })
  @ApiResponse({ status: 200, description: 'Auth mode info returned.' })
  async discover(@Body() dto: DiscoverDto) {
    return this.authService.discover(dto.email);
  }

  @Post('register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register with email and password' })
  @ApiResponse({ status: 201, description: 'Account created and JWT issued.' })
  @ApiResponse({ status: 409, description: 'Email already registered.' })
  async register(@Body() dto: RegisterPasswordDto) {
    return this.authService.registerPassword({
      email: dto.email,
      password: dto.password,
      displayName: dto.displayName || '',
      companyName: dto.companyName,
      companySlug: dto.companySlug,
    });
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'JWT issued.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  async login(@Body() dto: LoginPasswordDto) {
    return this.authService.loginPassword(dto.email, dto.password);
  }

  @Post('accept-invite')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept invitation and set password' })
  @ApiResponse({ status: 200, description: 'Account created and JWT issued.' })
  @ApiResponse({ status: 404, description: 'Invalid or expired invitation.' })
  async acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto.token, dto.password);
  }

  @Get('invitations/:token')
  @ApiOperation({ summary: 'Validate invitation token' })
  @ApiResponse({ status: 200, description: 'Invitation details returned.' })
  @ApiResponse({ status: 404, description: 'Invalid invitation.' })
  async validateInvite(@Param('token') token: string) {
    return this.authService.validateInviteToken(token);
  }

  @Post('google')
  @HttpCode(201)
  @ApiOperation({ summary: 'Exchange Google ID token for a JWT' })
  @ApiResponse({ status: 201, description: 'JWT issued.' })
  @ApiResponse({ status: 401, description: 'Invalid Google token or no matching account.' })
  async google(@Body() dto: GoogleLoginDto) {
    return this.authService.issueGoogleToken(dto.idToken);
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    if (!code) {
      return res.status(400).send('Missing authorization code');
    }
    try {
      const { accessToken } = await this.authService.exchangeGoogleCode(code);
      const deepLink = `eurisko-hub://auth?token=${encodeURIComponent(accessToken)}`;
      return res.type('html').send(`<!DOCTYPE html><html><head><title>Signing in...</title></head><body>
        <p>Redirecting to app...</p>
        <script>window.location.href=${JSON.stringify(deepLink)};</script>
        </body></html>`);
    } catch (err: any) {
      return res.status(401).send(`Authentication failed: ${err.message || 'Unknown error'}`);
    }
  }
}
