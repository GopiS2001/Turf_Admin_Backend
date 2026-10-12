import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { BookingsService } from '../bookings/bookings.service';
import { DATE_RULE } from '../bookings/dto/booking.dto';
import { Roles } from '../common/decorators/auth.decorators';
import { PaginationQueryDto, paginate } from '../common/dto/pagination.dto';
import { PaymentKind, PaymentType, Role } from '../common/enums';
import { Payment } from './payment.entity';

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentType })
  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  @ApiPropertyOptional({ enum: PaymentKind })
  @IsOptional()
  @IsEnum(PaymentKind)
  kind?: PaymentKind;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE_RULE)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DATE_RULE)
  to?: string;
}

@ApiTags('Payments')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('payments')
export class PaymentsController {
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly bookings: BookingsService,
  ) {}

  @Get()
  async list(@Query() query: ListPaymentsQueryDto) {
    const qb = this.payments
      .createQueryBuilder('p')
      .innerJoin('p.booking', 'b')
      .addSelect([
        'b.id',
        'b.bookingCode',
        'b.customerName',
        'b.customerPhone',
        'b.bookingDate',
        'b.totalAmount',
      ])
      .orderBy('p.paidAt', 'DESC')
      .addOrderBy('p.id', 'DESC');
    if (query.paymentType)
      qb.andWhere('p.paymentType = :t', { t: query.paymentType });
    if (query.kind) qb.andWhere('p.kind = :k', { k: query.kind });
    if (query.from)
      qb.andWhere('DATE(p.paidAt) >= :from', { from: query.from });
    if (query.to) qb.andWhere('DATE(p.paidAt) <= :to', { to: query.to });
    if (query.q) {
      const q = `%${query.q}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('b.customerName LIKE :q', { q })
            .orWhere('b.bookingCode LIKE :q', { q })
            .orWhere('p.transactionId LIKE :q', { q }),
        ),
      );
    }
    const [data, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginate(data, total, query.page, query.limit);
  }

  /** Remove a wrongly recorded payment; the booking and invoice are recalculated. */
  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.bookings.removePayment(id);
  }
}
