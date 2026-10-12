import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/auth.decorators';
import { Role } from '../common/enums';
import { BookingsService } from './bookings.service';
import {
  BookingCountsQueryDto,
  CreateBookingDto,
  ListBookingsQueryDto,
  PaymentInputDto,
  UpdateBookingDto,
} from './dto/booking.dto';

@ApiTags('Bookings')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(@Query() query: ListBookingsQueryDto) {
    return this.bookings.list(query);
  }

  /** Counts per status tab (Upcoming / Ongoing / Completed / Cancelled). */
  @Get('counts')
  counts(@Query() query: BookingCountsQueryDto) {
    return this.bookings.counts(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.bookings.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.bookings.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookingDto) {
    return this.bookings.update(id, dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.bookings.cancel(id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.bookings.remove(id);
  }

  /** Record a payment, advance or refund against the booking. */
  @Post(':id/payments')
  addPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PaymentInputDto,
  ) {
    return this.bookings.addPayment(id, dto);
  }
}
