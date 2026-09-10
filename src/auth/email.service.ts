import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Optional transactional email sender.
 *
 * Two providers, in order of preference:
 *  1. Brevo HTTP API (BREVO_API_KEY) — port 443, works from networks that
 *     block outbound SMTP (Render cannot reach smtp.gmail.com:587).
 *  2. SMTP (SMTP_HOST/USER/PASS) — kept as fallback.
 * When neither is configured, callers must fall back to manual delivery
 * (e.g. the admin shares the invitation code from the mobile app) — send
 * methods return a status instead of throwing so auth flows never break.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;
  private readonly brevoKey: string | undefined;

  constructor() {
    const host = process.env['SMTP_HOST'];
    const port = Number(process.env['SMTP_PORT'] || 587);
    const user = process.env['SMTP_USER'];
    const pass = process.env['SMTP_PASS'];
    this.from = process.env['SMTP_FROM'] || process.env['EMAIL_FROM'] || user || 'no-reply@internal-ops-hub.local';
    this.brevoKey = process.env['BREVO_API_KEY'] || undefined;

    if (this.brevoKey) {
      this.logger.log('Brevo HTTP email enabled');
    }

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
      });
      this.logger.log(`SMTP email enabled via ${host}:${port}`);
    } else {
      this.logger.warn('SMTP not configured — invitation emails disabled, manual code sharing only');
    }
  }

  get enabled(): boolean {
    return !!this.transporter || !!this.brevoKey;
  }

  private async sendViaBrevo(email: string, companyName: string, token: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': this.brevoKey as string },
        body: JSON.stringify({
          sender: { email: this.from === 'no-reply@internal-ops-hub.local' ? undefined : this.from, name: 'Internal Operations Hub' },
          to: [{ email }],
          subject: `You've been invited to join ${companyName}`,
          textContent:
            `You've been invited to join ${companyName} on Internal Operations Hub.\n\n` +
            `Open the app, tap "Have an invitation code?" on the login screen, and enter this code:\n\n${token}\n\n` +
            `You will set your own password on that screen. This code expires in 7 days.`,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.error(`Brevo rejected invitation email to ${email}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        return false;
      }
      this.logger.log(`Invitation email sent to ${email} via Brevo`);
      return true;
    } catch (e) {
      this.logger.error(`Brevo send to ${email} failed: ${(e as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async sendInvitation(
    email: string,
    companyName: string,
    token: string,
  ): Promise<{ sent: boolean; reason: 'disabled' | 'timeout' | 'error' | null }> {
    if (this.brevoKey) {
      const ok = await this.sendViaBrevo(email, companyName, token);
      return ok
        ? { sent: true, reason: null }
        : { sent: false, reason: 'error' };
    }
    if (!this.transporter) return { sent: false, reason: 'disabled' };
    // Never let a slow mail server hang the request: the mobile client
    // aborts at 12s, which surfaces as a confusing "network error".
    let failedFast = false;
    const send = this.transporter.sendMail({
      from: this.from,
      to: email,
      subject: `You've been invited to join ${companyName}`,
      text:
        `You've been invited to join ${companyName} on Internal Operations Hub.\n\n` +
        `Open the app, tap "Have an invitation code?" on the login screen, and enter this code:\n\n${token}\n\n` +
        `You will set your own password on that screen. This code expires in 7 days.`,
      html:
        `<p>You've been invited to join <strong>${companyName}</strong> on Internal Operations Hub.</p>` +
        `<p>Open the app, tap <strong>“Have an invitation code?”</strong> on the login screen, and enter this code:</p>` +
        `<p style="font-size:18px;font-weight:bold;letter-spacing:1px;">${token}</p>` +
        `<p>You will set your own password on that screen. This code expires in 7 days.</p>`,
    }).then(
      () => {
        this.logger.log(`Invitation email sent to ${email}`);
        return true;
      },
      (e) => {
        failedFast = true;
        this.logger.error(`Failed to send invitation email to ${email}: ${(e as Error).message}`);
        return false;
      },
    );
    const timedOut = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 9000));
    const result = await Promise.race([send, timedOut]);
    if (result) return { sent: true, reason: null };
    const reason = failedFast ? 'error' : 'timeout';
    this.logger.warn(`SMTP send to ${email} ${reason === 'timeout' ? 'timed out' : 'failed'} — admin must share the code manually`);
    return { sent: false, reason };
  }
}
