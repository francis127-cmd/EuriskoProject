import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VoiceTicketService } from './voice.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';

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
}
