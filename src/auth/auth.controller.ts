import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { IsString } from 'class-validator';

class SsoLoginDto {
  @IsString()
  ssoSubject!: string;
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
    return this.authService.issueToken(dto.ssoSubject);
  }
}
