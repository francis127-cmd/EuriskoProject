import { Controller, Post, Body, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InvitationService } from './invitation.service';
import { JwtGuard } from './jwt.guard';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { PlatformRole, DepartmentRole } from '@prisma/client';

class CreateInviteDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsEnum(PlatformRole)
  platformRole?: PlatformRole;

  @IsOptional()
  @IsString()
  departmentCode?: string;

  @IsOptional()
  @IsEnum(DepartmentRole)
  departmentRole?: DepartmentRole;
}

@ApiTags('invitations')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('invitations')
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  @Post()
  @ApiOperation({ summary: 'Admin creates an invitation for a new user' })
  async createInvite(@Body() dto: CreateInviteDto, @Request() req: any) {
    if (req.user.platformRole !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException('Only system admins can invite users');
    }

    return this.invitationService.createInvitation(
      req.user.companyId,
      dto.email,
      dto.platformRole,
      dto.departmentCode,
      dto.departmentRole
    );
  }
}
