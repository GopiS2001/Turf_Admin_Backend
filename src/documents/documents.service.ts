import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Handlebars from 'handlebars';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { Repository } from 'typeorm';
import { Booking } from '../bookings/booking.entity';
import { Invoice } from '../invoices/invoice.entity';
import {
  buildDocumentView,
  type BusinessInfo,
  type DocumentType,
} from './document-view';

const TEMPLATE_DIR = join(__dirname, 'templates');
const FONT_DIR = join(__dirname, 'fonts');
const FONTS = [
  { file: 'Outfit_400Regular.ttf', family: 'Outfit', weight: 400 },
  { file: 'Outfit_500Medium.ttf', family: 'Outfit', weight: 500 },
  { file: 'Outfit_600SemiBold.ttf', family: 'Outfit', weight: 600 },
  { file: 'BebasNeue_400Regular.ttf', family: 'Bebas Neue', weight: 400 },
];
const TEMPLATE_FILES: Record<DocumentType | 'email', string> = {
  invoice: 'invoice.hbs',
  booking: 'booking-confirmation.hbs',
  email: 'email.hbs',
};

export interface RenderedPdf {
  buffer: Buffer;
  filename: string;
  booking: Booking;
  invoice: Invoice;
}

/**
 * Renders invoices and booking confirmations from Handlebars templates and prints
 * them to PDF with Playwright's headless Chromium (one shared browser, a fresh page per document).
 */
@Injectable()
export class DocumentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly hbs = Handlebars.create();
  private templates = {} as Record<
    DocumentType | 'email',
    HandlebarsTemplateDelegate
  >;
  private fontFaces = '';
  private browser: Promise<Browser> | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
  ) {}

  onModuleInit() {
    const partialsDir = join(TEMPLATE_DIR, 'partials');
    for (const file of readdirSync(partialsDir).filter((f) =>
      f.endsWith('.hbs'),
    )) {
      this.hbs.registerPartial(
        file.replace(/\.hbs$/, ''),
        readFileSync(join(partialsDir, file), 'utf8'),
      );
    }
    for (const [key, file] of Object.entries(TEMPLATE_FILES)) {
      this.templates[key as DocumentType] = this.hbs.compile(
        readFileSync(join(TEMPLATE_DIR, file), 'utf8'),
      );
    }
    // Embed fonts so PDFs look the same on any server, with no network fetches.
    this.fontFaces = FONTS.map(
      (f) =>
        `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:normal;` +
        `src:url(data:font/ttf;base64,${readFileSync(join(FONT_DIR, f.file)).toString('base64')}) format('truetype');}`,
    ).join('\n');
  }

  async onModuleDestroy() {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }

  get business(): BusinessInfo {
    return {
      name: this.config.get('BUSINESS_NAME', '90s Turf'),
      address: this.config.get('BUSINESS_ADDRESS', ''),
      phone: this.config.get('BUSINESS_PHONE', ''),
      email: this.config.get('BUSINESS_EMAIL', ''),
    };
  }

  /** Public link customers can open without signing in. */
  shareUrl(type: DocumentType, token: string) {
    const base = this.config
      .get<string>('PUBLIC_BASE_URL', 'http://localhost:4000')
      .replace(/\/$/, '');
    return `${base}/api/public/documents/${type}/${token}.pdf`;
  }

  filename(type: DocumentType, booking: Booking, invoice: Invoice) {
    return type === 'invoice'
      ? `${invoice.invoiceCode}.pdf`
      : `Booking-${booking.bookingCode}.pdf`;
  }

  /** Booking with invoice + payments, making sure the invoice has a share token. */
  async load(bookingId: number) {
    const booking = await this.bookings.findOne({
      where: { id: bookingId },
      relations: { invoice: true, payments: true },
    });
    if (!booking?.invoice)
      throw new NotFoundException('Booking or invoice not found');
    const token = await this.ensureToken(booking.invoice.id);
    return { booking, invoice: booking.invoice, token };
  }

  async loadByToken(token: string) {
    const invoice = await this.invoices
      .createQueryBuilder('i')
      .addSelect('i.shareToken')
      .where('i.shareToken = :token', { token })
      .getOne();
    if (!invoice) throw new NotFoundException('Document not found');
    return this.load(invoice.bookingId);
  }

  renderHtml(type: DocumentType, booking: Booking, invoice: Invoice) {
    return this.templates[type]({
      ...buildDocumentView(type, booking, invoice, this.business),
      fontFaces: this.fontFaces,
    });
  }

  renderEmail(data: Record<string, unknown>) {
    return this.templates.email({ ...data, business: this.business });
  }

  async renderPdf(type: DocumentType, bookingId: number): Promise<RenderedPdf> {
    const { booking, invoice } = await this.load(bookingId);
    const html = this.renderHtml(type, booking, invoice);
    const buffer = await this.htmlToPdf(html);
    return {
      buffer,
      filename: this.filename(type, booking, invoice),
      booking,
      invoice,
    };
  }

  private async htmlToPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        scale: await this.fitScale(page),
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /**
   * If the page is only slightly taller than one A4 sheet, shrink it to fit (down to
   * 85%) so a stray footer doesn't spill onto a second page. Longer documents keep
   * normal size and flow onto more pages.
   */
  private async fitScale(page: Page) {
    const A4_PX = 1122; // 297mm at 96 dpi
    const height = await page.evaluate(() => document.body.scrollHeight);
    const scale = A4_PX / height;
    return scale < 1 && scale >= 0.85 ? Math.floor(scale * 100) / 100 : 1;
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = this.launchBrowser().catch((err: Error) => {
        this.browser = null;
        this.logger.error(`Could not start headless Chrome: ${err.message}`);
        throw new ServiceUnavailableException(
          'PDF generation is unavailable right now',
        );
      });
    }
    return this.browser;
  }

  /** Playwright's headless Chromium (install once with `npx playwright install chromium`). */
  private async launchBrowser(): Promise<Browser> {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    // If Chrome dies, start a new one on the next request.
    browser.on('disconnected', () => (this.browser = null));
    return browser;
  }

  private async ensureToken(invoiceId: number): Promise<string> {
    const row = await this.invoices
      .createQueryBuilder('i')
      .addSelect('i.shareToken')
      .where('i.id = :id', { id: invoiceId })
      .getOneOrFail();
    if (row.shareToken) return row.shareToken;
    const token = randomBytes(24).toString('hex');
    await this.invoices.update(invoiceId, { shareToken: token });
    return token;
  }
}
