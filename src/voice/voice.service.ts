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

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 2000;

export interface TicketDraft {
  departmentCode: string;
  requestTypeCode: string;
  title: string;
  description: string;
  priority: string;
}

/**
 * The model only ever sees the company's REAL catalog — it cannot invent
 * departments or categories, which is what makes the AI reliable instead of
 * confidently wrong. Nonsense input has an explicit escape hatch (UNKNOWN)
 * instead of a forced guess.
 */
function buildExtractionPrompt(
  departments: { code: string; name: string; types: { code: string; name: string }[] }[],
): string {
  const catalog = departments
    .map((d) => `- ${d.code} (${d.name}): ${d.types.map((t) => `${t.code} (${t.name})`).join(', ') || 'no categories'}`)
    .join('\n');
  return `You are an IT service desk data extractor. Analyze the user's message and output ONLY a raw JSON object matching this schema: { "departmentCode": "one of the valid department codes below", "requestTypeCode": "one of that department's valid category codes below", "title": "Professional 4-word subject", "description": "Professional rewrite of the issue", "priority": "URGENT if user sounds rushed/uses words like now/ASAP, else STANDARD" }.

Valid departments and categories for this company:
${catalog}

Rules: departmentCode and requestTypeCode MUST come from the lists above, and the category MUST belong to the chosen department. If the message is gibberish, empty of meaning, or not a service request at all, output {"departmentCode": "UNKNOWN", "requestTypeCode": "UNKNOWN", "title": "", "description": "", "priority": "STANDARD"}.`;
}

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

    const draft = await this.extractDraft(transcript, user, groq, 'recording');

    const ticket = await this.requestsService.createRequest(user, {
      departmentCode: draft.departmentCode,
      requestTypeCode: draft.requestTypeCode,
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
    });
    this.logger.log(`Voice ticket created: ${ticket.id} for ${user.email}`);
    return { ticket, transcript };
  }

  /**
   * Text path — same AI, no audio. With preview=true it only structures the
   * text into a draft (the app fills its form for human review); otherwise it
   * creates the ticket immediately, exactly like the voice flow.
   */
  async generateFromText(text: string, preview: boolean, user: AuthUser) {
    const transcript = (text || '').trim().slice(0, MAX_TEXT_CHARS);
    if (!transcript) {
      throw new BadRequestException('Describe your issue in a few words first.');
    }
    const groq = this.client();
    const draft = await this.extractDraft(transcript, user, groq, 'message');
    if (preview) return { draft, transcript };
    const ticket = await this.requestsService.createRequest(user, {
      departmentCode: draft.departmentCode,
      requestTypeCode: draft.requestTypeCode,
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
    });
    this.logger.log(`Text AI ticket created: ${ticket.id} for ${user.email}`);
    return { ticket, transcript };
  }

  /**
   * Shared Step B: ground the model in the company's real catalog, extract a
   * draft, and verify every code against the database. The core service
   * re-validates authoritatively at creation; this yields precise errors and
   * guarantees no ticket is ever created from hallucinated codes.
   */
  private async extractDraft(
    transcript: string,
    user: AuthUser,
    groq: Groq,
    sourceNoun: string,
  ): Promise<TicketDraft> {
    const departments = await this.prisma.department.findMany({
      where: { companyId: user.companyId },
      select: {
        code: true,
        name: true,
        requestTypes: {
          where: { active: true },
          select: { code: true, name: true },
        },
      },
    });
    if (departments.length === 0) {
      throw new BadRequestException('Your company has no departments set up yet.');
    }

    let extracted: any;
    try {
      const completion = await groq.chat.completions.create({
        model: 'llama3-8b-8192',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: buildExtractionPrompt(
              departments.map((d) => ({
                code: d.code,
                name: d.name,
                types: d.requestTypes.map((t) => ({ code: t.code, name: t.name })),
              })),
            ),
          },
          { role: 'user', content: transcript },
        ],
      });
      extracted = JSON.parse(completion.choices[0]?.message?.content || '');
    } catch (e) {
      this.logger.error(`Groq extraction failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        'Could not understand it. Please try again.',
      );
    }

    const departmentCode = String(extracted.departmentCode || '').trim().toUpperCase();
    const requestTypeCode = String(extracted.requestTypeCode || '').trim().toUpperCase();
    if (!departmentCode || !requestTypeCode || departmentCode === 'UNKNOWN' || requestTypeCode === 'UNKNOWN') {
      throw new BadRequestException(
        `Couldn't understand that ${sourceNoun} — please describe the actual issue (what's broken, what you need).`,
      );
    }

    const dept = await this.prisma.department.findFirst({
      where: { code: departmentCode, companyId: user.companyId },
    });
    if (!dept) {
      throw new BadRequestException(
        `Could not map it to a department ("${departmentCode}"). Try mentioning which team it's for.`,
      );
    }
    const reqType = await this.prisma.requestType.findFirst({
      where: { departmentId: dept.id, code: requestTypeCode, active: true },
    });
    if (!reqType) {
      throw new BadRequestException(
        `Could not map it to a request type ("${requestTypeCode}"). Try naming the category.`,
      );
    }

    const title = String(extracted.title || '').trim() || transcript.slice(0, 80);
    const description = String(extracted.description || '').trim() || transcript;
    const priority =
      String(extracted.priority || '').trim().toUpperCase() === 'URGENT' ? 'URGENT' : 'STANDARD';
    return { departmentCode: dept.code, requestTypeCode: reqType.code, title, description, priority };
  }
}
