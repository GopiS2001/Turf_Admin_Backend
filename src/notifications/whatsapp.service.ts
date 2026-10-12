import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** "98765 43210" / "+91 98765-43210" → "919876543210" (WhatsApp wants country code, digits only). */
export function toWhatsAppNumber(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0'))
    return `91${digits.slice(1)}`;
  return digits;
}

/**
 * WhatsApp delivery.
 * - With WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID (Meta WhatsApp Cloud API), the PDF
 *   is sent automatically as a document message.
 * - Without them, `chatLink` gives a click-to-chat link that opens WhatsApp with the
 *   customer and a message containing the PDF link, ready to send.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return !!(
      this.config.get('WHATSAPP_TOKEN') &&
      this.config.get('WHATSAPP_PHONE_NUMBER_ID')
    );
  }

  chatLink(phone: string, text: string) {
    return `https://wa.me/${toWhatsAppNumber(phone)}?text=${encodeURIComponent(text)}`;
  }

  /** Sends a PDF by public link. Meta fetches the file, so the link must be reachable from the internet. */
  async sendDocument(options: {
    to: string;
    link: string;
    filename: string;
    caption: string;
  }) {
    const phoneId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${phoneId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.get<string>('WHATSAPP_TOKEN')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toWhatsAppNumber(options.to),
          type: 'document',
          document: {
            link: options.link,
            filename: options.filename,
            caption: options.caption,
          },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error(
        `WhatsApp send failed (${res.status}): ${detail.slice(0, 300)}`,
      );
      throw new BadGatewayException('WhatsApp did not accept the message');
    }
    return (await res.json()) as { messages?: { id: string }[] };
  }
}
