import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Brackets, Repository } from 'typeorm';
import { DATE_RULE } from '../bookings/dto/booking.dto';
import { Roles } from '../common/decorators/auth.decorators';
import { PaginationQueryDto, paginate } from '../common/dto/pagination.dto';
import { InvoiceStatus, Role } from '../common/enums';
import { Invoice } from './invoice.entity';

export class ListInvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE_RULE)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DATE_RULE)
  to?: string;
}

/** Status normally follows payments; this allows manual correction. */
export class UpdateInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  customerName?: string;

  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;
}

@ApiTags('Invoices')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('invoices')
export class InvoicesController {
  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
  ) {}

  @Get()
  async list(@Query() query: ListInvoicesQueryDto) {
    const qb = this.invoices
      .createQueryBuilder('i')
      .leftJoin('i.booking', 'b')
      .addSelect([
        'b.id',
        'b.bookingCode',
        'b.bookingDate',
        'b.timeIn',
        'b.timeOut',
        'b.status',
        'b.paymentType',
      ])
      .orderBy('i.invoiceDate', 'DESC')
      .addOrderBy('i.id', 'DESC');
    if (query.status) qb.andWhere('i.status = :s', { s: query.status });
    if (query.from)
      qb.andWhere('DATE(i.invoiceDate) >= :from', { from: query.from });
    if (query.to) qb.andWhere('DATE(i.invoiceDate) <= :to', { to: query.to });
    if (query.q) {
      const q = `%${query.q}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('i.invoiceCode LIKE :q', { q })
            .orWhere('i.customerName LIKE :q', { q })
            .orWhere('b.bookingCode LIKE :q', { q }),
        ),
      );
    }
    const [data, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginate(data, total, query.page, query.limit);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const invoice = await this.invoices.findOne({
      where: { id },
      relations: { booking: { payments: true } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInvoiceDto,
  ) {
    await this.findOne(id);
    await this.invoices.update(id, dto);
    return this.findOne(id);
  }
}
