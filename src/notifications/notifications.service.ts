import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InvoiceStatus } from '../common/enums';
import {
  formatDateTime,
  inr,
  type DocumentType,
} from '../documents/document-view';
import { DocumentsService } from '../documents/documents.service';
import { BOOKING_CREATED, BOOKING_PAID, type BookingEvent } from './events';
import { MailService } from './mail.service';
import { WhatsAppService } from './whatsapp.service';

export type Channel = 'email' | 'whatsapp';

export interface SendResult {
  channel: Channel;
  /** True when the message actually went out (email, or WhatsApp Cloud API). */
  sent: boolean;
  to: string;
  pdfUrl: string;
  /** WhatsApp without Cloud API: open this to send the message yourself. */
  whatsappUrl?: string;
  /** Development email: view the captured message here. */
  previewUrl?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /** Links for the "share" buttons in the apps. */
  async links(type: DocumentType, bookingId: number) {
    const { booking, invoice, token } = await this.documents.load(bookingId);
    const pdfUrl = this.documents.shareUrl(type, token);
    return {
      pdfUrl,
      filename: this.documents.filename(type, booking, invoice),
      whatsappUrl: this.whatsapp.chatLink(
        booking.customerPhone,
        this.whatsappText(
          type,
          booking.customerName,
          booking.bookingCode,
          invoice.invoiceCode,
          pdfUrl,
        ),
      ),
      email: booking.customerEmail,
      whatsappAutomatic: this.whatsapp.enabled,
      emailTestInbox: this.mail.usesTestInbox,
    };
  }

  async send(
    type: DocumentType,
    bookingId: number,
    channel: Channel,
    to?: string,
  ): Promise<SendResult> {
    return channel === 'email'
      ? this.sendEmail(type, bookingId, to)
      : this.sendWhatsApp(type, bookingId, to);
  }

  async sendEmail(
    type: DocumentType,
    bookingId: number,
    to?: string,
  ): Promise<SendResult> {
    const pdf = await this.documents.renderPdf(type, bookingId);
    const { booking, invoice } = pdf;
    const recipient = (to ?? booking.customerEmail ?? '').trim();
    if (!recipient)
      throw new BadRequestException(
        'This customer has no email address. Enter one to send the PDF.',
      );

    const { token } = await this.documents.load(bookingId);
    const pdfUrl = this.documents.shareUrl(type, token);
    const business = this.documents.business.name;
    const isInvoice = type === 'invoice';
    const slot = `${booking.bookingDate} · ${booking.timeIn.slice(0, 5)}–${booking.timeOut.slice(0, 5)}`;

    const subject = isInvoice
      ? `Invoice ${invoice.invoiceCode} — ${business}`
      : `Booking confirmed ${booking.bookingCode} — ${business}`;
    const facts = isInvoice
      ? [
          { label: 'Invoice', value: invoice.invoiceCode },
          { label: 'Booking', value: booking.bookingCode },
          { label: 'Total', value: inr(booking.totalAmount) },
          { label: 'Paid', value: inr(booking.amountPaid) },
          { label: 'Issued', value: formatDateTime(invoice.invoiceDate) },
        ]
      : [
          { label: 'Booking reference', value: booking.bookingCode },
          { label: 'Slot', value: slot },
          { label: 'Total', value: inr(booking.totalAmount) },
          { label: 'Paid so far', value: inr(booking.amountPaid) },
        ];
    const balance = Math.max(0, booking.totalAmount - booking.amountPaid);
    const intro = !isInvoice
      ? `Your turf booking is confirmed. Show the booking reference ${booking.bookingCode} at the desk when you arrive.`
      : invoice.status === InvoiceStatus.PAID
        ? `Thank you for your payment — booking ${booking.bookingCode} is paid in full. Your invoice ${invoice.invoiceCode} is attached.`
        : balance > 0 && invoice.status !== InvoiceStatus.CANCELLED
          ? `Here is your invoice ${invoice.invoiceCode} for booking ${booking.bookingCode}. The balance due is ${inr(balance)}.`
          : `Here is your invoice ${invoice.invoiceCode} for booking ${booking.bookingCode}.`;

    const html = this.documents.renderEmail({
      eyebrow: isInvoice ? 'Invoice' : 'Booking confirmed',
      customerName: booking.customerName.split(' ')[0],
      intro,
      facts,
      pdfUrl,
      documentName: isInvoice ? 'invoice' : 'booking confirmation',
    });
    const text = `${intro}\n\n${facts.map((f) => `${f.label}: ${f.value}`).join('\n')}\n\nPDF: ${pdfUrl}`;

    const result = await this.mail.send({
      to: recipient,
      subject,
      html,
      text,
      attachments: [
        {
          filename: pdf.filename,
          content: pdf.buffer,
          contentType: 'application/pdf',
        },
      ],
    });
    this.logger.log(
      `Emailed ${type} for ${booking.bookingCode} to ${recipient}`,
    );
    return {
      channel: 'email',
      sent: true,
      to: recipient,
      pdfUrl,
      previewUrl: result.previewUrl,
    };
  }

  async sendWhatsApp(
    type: DocumentType,
    bookingId: number,
    to?: string,
  ): Promise<SendResult> {
    const { booking, invoice, token } = await this.documents.load(bookingId);
    const phone = (to ?? booking.customerPhone).trim();
    const pdfUrl = this.documents.shareUrl(type, token);
    const text = this.whatsappText(
      type,
      booking.customerName,
      booking.bookingCode,
      invoice.invoiceCode,
      pdfUrl,
    );

    if (!this.whatsapp.enabled) {
      return {
        channel: 'whatsapp',
        sent: false,
        to: phone,
        pdfUrl,
        whatsappUrl: this.whatsapp.chatLink(phone, text),
      };
    }
    await this.whatsapp.sendDocument({
      to: phone,
      link: pdfUrl,
      filename: this.documents.filename(type, booking, invoice),
      caption: text,
    });
    this.logger.log(
      `WhatsApp ${type} for ${booking.bookingCode} sent to ${phone}`,
    );
    return { channel: 'whatsapp', sent: true, to: phone, pdfUrl };
  }

  // ───────────── Automatic sending ─────────────

  @OnEvent(BOOKING_CREATED, { async: true })
  onBookingCreated({ bookingId }: BookingEvent) {
    return this.autoSend('booking', bookingId);
  }

  @OnEvent(BOOKING_PAID, { async: true })
  onBookingPaid({ bookingId }: BookingEvent) {
    return this.autoSend('invoice', bookingId);
  }

  /** Best effort: never throws, so a mail or WhatsApp outage can't affect bookings. */
  private async autoSend(type: DocumentType, bookingId: number) {
    if (this.config.get('AUTO_SEND_DOCUMENTS', 'true') !== 'true') return;
    try {
      const { booking } = await this.documents.load(bookingId);
      if (booking.customerEmail) {
        await this.sendEmail(type, bookingId).catch((err: Error) =>
          this.logger.warn(
            `Auto email (${type}) for ${booking.bookingCode} failed: ${err.message}`,
          ),
        );
      }
      if (this.whatsapp.enabled && booking.customerPhone) {
        await this.sendWhatsApp(type, bookingId).catch((err: Error) =>
          this.logger.warn(
            `Auto WhatsApp (${type}) for ${booking.bookingCode} failed: ${err.message}`,
          ),
        );
      }
    } catch (err) {
      this.logger.warn(
        `Auto send (${type}) for booking ${bookingId} skipped: ${(err as Error).message}`,
      );
    }
  }

  private whatsappText(
    type: DocumentType,
    name: string,
    bookingCode: string,
    invoiceCode: string,
    pdfUrl: string,
  ) {
    const business = this.documents.business.name;
    const first = name.split(' ')[0];
    return type === 'invoice'
      ? `Hi ${first}, thank you for playing at ${business}! Here is your invoice ${invoiceCode} for booking ${bookingCode}: ${pdfUrl}`
      : `Hi ${first}, your ${business} booking ${bookingCode} is confirmed. Booking details (PDF): ${pdfUrl}`;
  }
}
