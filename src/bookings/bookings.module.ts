import {
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesController } from '../invoices/invoices.controller';
import { Invoice } from '../invoices/invoice.entity';
import { PaymentsController } from '../payments/payments.controller';
import { Payment } from '../payments/payment.entity';
import { PricingModule } from '../pricing/pricing.module';
import { Booking } from './booking.entity';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

/** Keeps UPCOMING / ONGOING / COMPLETED in step with the clock. */
@Injectable()
export class BookingStatusScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(BookingStatusScheduler.name);

  constructor(private readonly bookings: BookingsService) {}

  onApplicationBootstrap() {
    return this.run();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async run() {
    try {
      await this.bookings.syncStatuses();
    } catch (err) {
      this.logger.error('Booking status sync failed', err as Error);
    }
  }
}

// Bookings, payments and invoices change together (a booking owns its invoice and
// payments), so they share one module and one service.
@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Payment, Invoice]),
    PricingModule,
  ],
  controllers: [BookingsController, PaymentsController, InvoicesController],
  providers: [BookingsService, BookingStatusScheduler],
  exports: [BookingsService],
})
export class BookingsModule {}
