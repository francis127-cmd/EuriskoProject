import { Controller, Post, Get, Body, HttpCode, Query, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { IsString, IsOptional } from 'class-validator';

class SsoLoginDto {
  @IsOptional()
  @IsString()
  ssoSubject?: string;
}

class GoogleLoginDto {
  @IsString()
  idToken!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('token')
  @HttpCode(201)
  @ApiOperation({ summary: 'Exchange SSO subject for a JWT (mock SSO)' })
  @ApiResponse({ status: 201, description: 'JWT issued.' })
  @ApiResponse({ status: 401, description: 'Unknown or inactive user.' })
  async token(@Body() dto: SsoLoginDto) {
    if (!dto.ssoSubject) {
      return { accessToken: '' };
    }
    return this.authService.issueToken(dto.ssoSubject);
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
  @ApiOperation({ summary: 'Google OAuth callback — exchanges code for JWT, redirects to app via deep link' })
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
