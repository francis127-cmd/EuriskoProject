import { Controller, Post, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { InvitationService } from './invitation.service';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateInvitationDto, @Body('companyId') companyId: string) {
    return this.invitationService.create({
      companyId,
      email: dto.email,
      platformRole: dto.platformRole,
      departmentCode: dto.departmentCode,
      departmentRole: dto.departmentRole,
    });
  }
}
