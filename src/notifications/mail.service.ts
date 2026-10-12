import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailResult {
  messageId: string;
  /** Ethereal (development) only: a link to view the captured email. */
  previewUrl?: string;
}

/**
 * Sends email through the configured SMTP server. In development with no SMTP_HOST,
 * it uses a free Ethereal test inbox: nothing is delivered, but every message can be
 * viewed at the logged preview URL.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport: Promise<{
    transporter: Transporter;
    testInbox: boolean;
  }> | null = null;

  constructor(private readonly config: ConfigService) {}

  get usesTestInbox() {
    return (
      !this.config.get<string>('SMTP_HOST') &&
      this.config.get('NODE_ENV') !== 'production'
    );
  }

  async send(options: {
    to: string;
    subject: string;
    html: string;
    text: string;
    attachments?: { filename: string; content: Buffer; contentType: string }[];
  }): Promise<MailResult> {
    const { transporter, testInbox } = await this.getTransport();
    const info = (await transporter.sendMail({
      from: this.config.get('MAIL_FROM', '90s Turf <no-reply@90sturf.in>'),
      ...options,
    })) as { messageId: string };
    const previewUrl = testInbox
      ? nodemailer.getTestMessageUrl(info as never) || undefined
      : undefined;
    if (previewUrl)
      this.logger.log(`Test email to ${options.to} → ${previewUrl}`);
    return { messageId: info.messageId, previewUrl };
  }

  private getTransport() {
    if (!this.transport) {
      this.transport = this.createTransport().catch((err: Error) => {
        this.transport = null;
        this.logger.error(`Email is unavailable: ${err.message}`);
        throw new ServiceUnavailableException(
          'Email is not available right now',
        );
      });
    }
    return this.transport;
  }

  private async createTransport() {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      const transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get('SMTP_PORT', 587)),
        secure: this.config.get('SMTP_SECURE') === 'true',
        auth: this.config.get('SMTP_USER')
          ? {
              user: this.config.get<string>('SMTP_USER'),
              pass: this.config.get<string>('SMTP_PASS'),
            }
          : undefined,
      });
      return { transporter, testInbox: false };
    }
    if (this.config.get('NODE_ENV') === 'production') {
      throw new Error('SMTP_HOST is not set');
    }
    const account = await nodemailer.createTestAccount();
    this.logger.warn(
      `SMTP not configured — using Ethereal test inbox ${account.user} (emails are not delivered)`,
    );
    const transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass },
    });
    return { transporter, testInbox: true };
  }
}
