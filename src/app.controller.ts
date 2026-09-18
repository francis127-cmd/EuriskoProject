import { Controller, Get, Header } from '@nestjs/common';
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

  /**
   * Minimal public landing page. Used as the homepage URL for OAuth brand
   * verification. Machine clients keep using the JSON endpoints above.
   */
  @Get('home')
  @Header('Content-Type', 'text/html; charset=utf-8')
  home(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Internal Operations Hub</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1a1a1a}h1{font-size:1.8rem}.btn{display:inline-block;margin:.4rem .4rem 0 0;padding:.6rem 1.1rem;border:1px solid #2563eb;border-radius:8px;color:#2563eb;text-decoration:none}</style>
</head>
<body>
<h1>Internal Operations Hub</h1>
<p>Internal Operations Hub is a workplace service-desk app: employees submit requests, departments triage them, and agents resolve them — with Google sign-in, invitations, and document handling per company workspace.</p>
<p><a class="btn" href="/legal/privacy.html">Privacy Policy</a><a class="btn" href="/legal/terms.html">Terms of Service</a></p>
<p>Contact: operationshub031@gmail.com</p>
</body>
</html>`;
  }
}
