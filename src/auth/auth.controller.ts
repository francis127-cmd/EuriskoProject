import { Controller, Post, Body, Get, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

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

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('discover')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async discover(@Body() dto: DiscoverDto) {
    return this.authService.discover(dto.email);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.loginPassword(dto.email, dto.password, dto.companySlug);
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  async register(@Body() dto: RegisterDto) {
    return this.authService.registerPassword(dto);
  }

  @Post('google')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async googleLogin(@Body() dto: GoogleLoginDto) {
    return this.authService.loginGoogle(dto.idToken);
  }

  @Post('accept-invite')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto.token, dto.password);
  }

  @Get('invitations/:token')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async validateInviteToken(@Param('token') token: string) {
    return this.authService.validateInviteToken(token);
  }
}
