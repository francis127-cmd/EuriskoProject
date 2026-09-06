import { Controller, Post, Get, Body, HttpCode, Query, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { IsString, IsEmail } from 'class-validator';

class DiscoverDto {
  @IsEmail()
  email!: string;
}

class GoogleLoginDto {
  @IsString()
  idToken!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('discover')
  @HttpCode(200)
  @ApiOperation({ summary: 'Discover SSO provider for an email address' })
  @ApiResponse({ status: 200, description: 'SSO provider info returned.' })
  @ApiResponse({ status: 404, description: 'No company found for this email domain.' })
  async discover(@Body() dto: DiscoverDto) {
    return this.authService.discover(dto.email);
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
