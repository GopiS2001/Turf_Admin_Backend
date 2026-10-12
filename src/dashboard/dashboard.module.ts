import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/booking.entity';
import { BookingsModule } from '../bookings/bookings.module';
import { Payment } from '../payments/payment.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, Payment]), BookingsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
