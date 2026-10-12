import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { Public, Roles } from '../common/decorators/auth.decorators';
import { Role } from '../common/enums';
import {
  NotificationsService,
  type Channel,
} from '../notifications/notifications.service';
import type { DocumentType } from './document-view';
import { DocumentsService } from './documents.service';

const DOC_TYPES = { invoice: 'invoice', booking: 'booking' } as const;

export class SendDocumentDto {
  @ApiProperty({ enum: ['email', 'whatsapp'] })
  @IsIn(['email', 'whatsapp'])
  channel: Channel;

  @ApiPropertyOptional({
    description:
      "Email address or phone number. Defaults to the booking's customer.",
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(150)
  to?: string;
}

const pdfHeaders = (res: Response, filename: string, inline: boolean) => {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  });
};

/** Admin: download, share links and sending. `:type` is `invoice` or `booking` (confirmation). */
@ApiTags('Documents (PDF)')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get(':type/:bookingId/pdf')
  async download(
    @Param('type', new ParseEnumPipe(DOC_TYPES)) type: DocumentType,
    @Param('bookingId', ParseIntPipe) bookingId: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pdf = await this.documents.renderPdf(type, bookingId);
    pdfHeaders(res, pdf.filename, false);
    return new StreamableFile(pdf.buffer);
  }

  @Get(':type/:bookingId/links')
  links(
    @Param('type', new ParseEnumPipe(DOC_TYPES)) type: DocumentType,
    @Param('bookingId', ParseIntPipe) bookingId: number,
  ) {
    return this.notifications.links(type, bookingId);
  }

  @Post(':type/:bookingId/send')
  send(
    @Param('type', new ParseEnumPipe(DOC_TYPES)) type: DocumentType,
    @Param('bookingId', ParseIntPipe) bookingId: number,
    @Body() dto: SendDocumentDto,
  ) {
    return this.notifications.send(type, bookingId, dto.channel, dto.to);
  }
}

/** Customer-facing PDF links (opened from WhatsApp/email). The token is a 48-character random secret. */
@ApiTags('Public (website)')
@Public()
@Controller('public/documents')
export class PublicDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':type/:file')
  async view(
    @Param('type', new ParseEnumPipe(DOC_TYPES)) type: DocumentType,
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = file.replace(/\.pdf$/i, '');
    if (!/^[a-f0-9]{48}$/.test(token))
      throw new NotFoundException('Document not found');
    const { booking } = await this.documents.loadByToken(token);
    const pdf = await this.documents.renderPdf(type, booking.id);
    pdfHeaders(res, pdf.filename, true);
    return new StreamableFile(pdf.buffer);
  }
}
