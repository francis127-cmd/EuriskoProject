import { Module } from '@nestjs/common';
import { RequestsModule } from '../requests/requests.module';
import { AdminPrismaService } from '../admin-prisma.service';
import { VoiceTicketController } from './voice.controller';
import { VoiceTicketService } from './voice.service';

@Module({
  imports: [RequestsModule],
  controllers: [VoiceTicketController],
  providers: [VoiceTicketService, AdminPrismaService],
})
export class VoiceModule {}
