import { IsString, IsOptional, IsEnum, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class CreateRequestDto {
  @IsString()
  @IsNotEmpty()
  departmentCode!: string;

  @IsString()
  @IsNotEmpty()
  requestTypeCode!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(5000)
  @IsOptional()
  description?: string;

  @IsEnum(['LOW', 'STANDARD', 'URGENT'] as const)
  @IsOptional()
  priority?: 'LOW' | 'STANDARD' | 'URGENT';
}

export class UpdateRequestStatusDto {
  @IsEnum(['IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const)
  status!: 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

  @IsString()
  @MaxLength(5000)
  @IsOptional()
  resolutionNote?: string;

  @IsString()
  @MaxLength(5000)
  @IsOptional()
  rejectionReason?: string;
}

export class ClaimRequestDto {
  @IsOptional()
  @IsString()
  requestId?: string;
}
