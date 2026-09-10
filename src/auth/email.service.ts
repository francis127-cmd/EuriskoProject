import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Optional transactional email sender.
 *
 * Enabled only when SMTP_HOST, SMTP_USER and SMTP_PASS are set.
 * When disabled, callers must fall back to manual delivery (e.g. the
 * admin shares the invitation code from the mobile app) — send methods
 * return false instead of throwing so auth flows never break.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;

  constructor() {
    const host = process.env['SMTP_HOST'];
    const port = Number(process.env['SMTP_PORT'] || 587);
    const user = process.env['SMTP_USER'];
    const pass = process.env['SMTP_PASS'];
    this.from = process.env['SMTP_FROM'] || user || 'no-reply@internal-ops-hub.local';

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
    return !!this.transporter;
  }

  async sendInvitation(
    email: string,
    companyName: string,
    token: string,
  ): Promise<{ sent: boolean; reason: 'disabled' | 'timeout' | 'error' | null }> {
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
