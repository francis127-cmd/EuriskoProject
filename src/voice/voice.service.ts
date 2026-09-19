import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Groq from 'groq-sdk';
import { createReadStream, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { AdminPrismaService } from '../admin-prisma.service';
import { RequestsService } from '../requests/requests.service';
import { AuthUser } from '../auth/auth.service';

const EXTRACTION_SYSTEM_PROMPT = `You are an IT service desk data extractor. Analyze the user's transcript and output ONLY a raw JSON object matching this schema: { "departmentCode": "HR or IT or FINANCE", "requestTypeCode": "One word category like LAPTOP or ACCESS", "title": "Professional 4-word subject", "description": "Professional rewrite of the issue", "priority": "URGENT if user sounds rushed/uses words like now/ASAP, else STANDARD" }.`;

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * Voice-to-ticket wrapper. Transcribes audio (Whisper), extracts a ticket
 * draft (Llama 3), validates the AI's codes against the caller's company,
 * then feeds the payload into the existing request-creation flow.
 * requests.service.ts is never modified — this only prepares its input.
 */
@Injectable()
export class VoiceTicketService {
  private readonly logger = new Logger(VoiceTicketService.name);

  constructor(
    private readonly prisma: AdminPrismaService,
    private readonly requestsService: RequestsService,
  ) {}

  private client(): Groq {
    const apiKey = process.env['GROQ_API_KEY'];
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Voice tickets are not configured (missing GROQ_API_KEY).',
      );
    }
    return new Groq({ apiKey });
  }

  async generateFromAudio(file: Express.Multer.File, user: AuthUser) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No audio file received.');
    }
    if (file.size > MAX_AUDIO_BYTES) {
      throw new BadRequestException('Audio file too large (max 10MB).');
    }
    const name = (file.originalname || '').toLowerCase();
    const isAudio =
      (file.mimetype || '').startsWith('audio/') ||
      name.endsWith('.m4a') ||
      name.endsWith('.mp3') ||
      name.endsWith('.wav');
    if (!isAudio) {
      throw new BadRequestException('Only audio uploads are accepted.');
    }

    const groq = this.client();

    // Step A — transcription. Groq's SDK streams files, so the buffer is
    // staged to a temp file (always cleaned up) rather than held in memory.
    const tmpPath = join(tmpdir(), `voice-${randomUUID()}.m4a`);
    await fs.writeFile(tmpPath, file.buffer);
    let transcript = '';
    try {
      const res = await groq.audio.transcriptions.create({
        file: createReadStream(tmpPath),
        model: 'whisper-large-v3',
        response_format: 'json',
        temperature: 0,
      });
      transcript = (res.text || '').trim();
    } catch (e) {
      this.logger.error(`Groq transcription failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        'Speech transcription failed. Please try again.',
      );
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
    if (!transcript) {
      throw new BadRequestException('Could not hear anything in the recording.');
    }

    // Step B — extraction to a strict JSON object.
    let extracted: any;
    try {
      const completion = await groq.chat.completions.create({
        model: 'llama3-8b-8192',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: transcript },
        ],
      });
      extracted = JSON.parse(completion.choices[0]?.message?.content || '');
    } catch (e) {
      this.logger.error(`Groq extraction failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        'Could not understand the recording. Please try again.',
      );
    }

    const departmentCode = String(extracted.departmentCode || '').trim().toUpperCase();
    const requestTypeCode = String(extracted.requestTypeCode || '').trim().toUpperCase();
    const title = String(extracted.title || '').trim() || transcript.slice(0, 80);
    const description = String(extracted.description || '').trim() || transcript;
    const priority =
      String(extracted.priority || '').trim().toUpperCase() === 'URGENT'
        ? 'URGENT'
        : 'STANDARD';

    // Verify the AI's codes against this company (the core service
    // re-validates authoritatively; this yields precise, user-facing errors).
    const dept = departmentCode
      ? await this.prisma.department.findFirst({
          where: { code: departmentCode, companyId: user.companyId },
        })
      : null;
    if (!dept) {
      throw new BadRequestException(
        `Could not map the recording to a department${departmentCode ? ` ("${departmentCode}")` : ''}.`,
      );
    }
    const reqType = requestTypeCode
      ? await this.prisma.requestType.findFirst({
          where: { departmentId: dept.id, code: requestTypeCode, active: true },
        })
      : null;
    if (!reqType) {
      throw new BadRequestException(
        `Could not map the recording to a request type${requestTypeCode ? ` ("${requestTypeCode}")` : ''}.`,
      );
    }

    const ticket = await this.requestsService.createRequest(user, {
      departmentCode: dept.code,
      requestTypeCode: reqType.code,
      title,
      description,
      priority,
    });
    this.logger.log(`Voice ticket created: ${ticket.id} for ${user.email}`);
    return { ticket, transcript };
  }
}
