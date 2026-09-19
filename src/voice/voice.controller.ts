import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { VoiceTicketService } from './voice.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';

class AiTextDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text!: string;

  @IsOptional()
  @IsBoolean()
  preview?: boolean;
}

@Controller('requests')
export class VoiceTicketController {
  constructor(private readonly voiceTickets: VoiceTicketService) {}

  @Post('ai-generate')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async generate(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) {
      throw new BadRequestException('Attach an audio file as "file".');
    }
    return this.voiceTickets.generateFromAudio(file, user);
  }

  @Post('ai-generate-text')
  async generateFromText(@Body() dto: AiTextDto, @CurrentUser() user: AuthUser) {
    return this.voiceTickets.generateFromText(dto.text, dto.preview === true, user);
  }
}
