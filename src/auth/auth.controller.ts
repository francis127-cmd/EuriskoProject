import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
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
}
