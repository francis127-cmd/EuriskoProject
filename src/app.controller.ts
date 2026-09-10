import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator';
import { AdminPrismaService } from './admin-prisma.service';
import { EmailService } from './auth/email.service';

@Public()
@Controller()
export class AppController {
  constructor(
    private readonly adminPrisma: AdminPrismaService,
    private readonly email: EmailService,
  ) {}

  @Get('health')
  async health() {
    const checks: Record<string, string> = {};
    const start = Date.now();

    try {
      await this.adminPrisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    const latencyMs = Date.now() - start;
    const allHealthy = Object.values(checks).every((v) => v === 'ok');

    return {
      status: allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      latencyMs,
      checks,
      // Informational only: which invite-email provider the running
      // instance sees ('brevo' | 'smtp' | 'disabled'). Never a secret.
      email: this.email.status(),
    };
  }

  @Get()
  root() {
    return { message: 'Internal Operations Hub API', status: 'online' };
  }
}
