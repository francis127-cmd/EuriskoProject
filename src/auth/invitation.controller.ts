import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { InvitationService } from './invitation.service';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.service';
import { Roles } from './roles.decorator';
import { PlatformRole } from '@prisma/client';

class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  platformRole?: string;

  @IsOptional()
  @IsString()
  departmentCode?: string;

  @IsOptional()
  @IsString()
  departmentRole?: string;
}

@Controller('invitations')
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  @Post()
  @Roles(PlatformRole.SYSTEM_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateInvitationDto, @CurrentUser() user: AuthUser) {
    return this.invitationService.create({
      companyId: user.companyId,
      email: dto.email,
      platformRole: dto.platformRole,
      departmentCode: dto.departmentCode,
      departmentRole: dto.departmentRole,
    });
  }
}
