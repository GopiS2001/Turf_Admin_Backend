import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/booking.entity';
import { Invoice } from '../invoices/invoice.entity';
import { MailService } from '../notifications/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsAppService } from '../notifications/whatsapp.service';
import {
  DocumentsController,
  PublicDocumentsController,
} from './documents.controller';
import { DocumentsService } from './documents.service';

/** PDF invoices / booking confirmations and sending them by email or WhatsApp. */
@Module({
  imports: [TypeOrmModule.forFeature([Booking, Invoice])],
  controllers: [DocumentsController, PublicDocumentsController],
  providers: [
    DocumentsService,
    MailService,
    WhatsAppService,
    NotificationsService,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
