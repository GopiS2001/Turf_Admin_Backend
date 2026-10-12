import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  BookingStatus,
  DateRange,
  PaymentKind,
  PaymentStatus,
  PaymentType,
} from '../../common/enums';
import { PHONE_RULE } from '../../users/dto/user.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const DATE_RULE = /^\d{4}-\d{2}-\d{2}$/;
/** HH:00 or HH:30, up to 24:00 */
export const TIME_RULE = /^(([01]\d|2[0-3]):(00|30)|24:00)$/;

export class PaymentInputDto {
  @ApiProperty({ example: 500 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({
    enum: PaymentKind,
    description:
      'REFUND returns money. Otherwise ADVANCE/PAID is worked out from the balance.',
  })
  @IsOptional()
  @IsEnum(PaymentKind)
  kind?: PaymentKind;

  @ApiProperty({ enum: PaymentType })
  @IsEnum(PaymentType)
  paymentType: PaymentType;

  @ApiPropertyOptional({ example: 'UPI-4521XXXX' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  transactionId?: string;

  @ApiPropertyOptional({ description: 'Defaults to now' })
  @IsOptional()
  @Type(() => Date)
  paidAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class CreateBookingDto {
  @ApiPropertyOptional({ description: 'Link to a registered user' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  userId?: number;

  @ApiProperty({ example: 'Karthik R' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  customerName: string;

  @ApiProperty({ example: '98765 43210' })
  @Transform(trim)
  @Matches(PHONE_RULE, {
    message: 'customerPhone must be a valid 10-digit Indian mobile number',
  })
  customerPhone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  customerEmail?: string;

  @ApiProperty({ example: '2026-10-10' })
  @Matches(DATE_RULE, { message: 'bookingDate must be YYYY-MM-DD' })
  bookingDate: string;

  @ApiProperty({ example: '18:00' })
  @Matches(TIME_RULE, { message: 'timeIn must be HH:00 or HH:30' })
  timeIn: string;

  @ApiProperty({ example: '20:00' })
  @Matches(TIME_RULE, {
    message: 'timeOut must be HH:00 or HH:30 (24:00 for midnight)',
  })
  timeOut: string;

  @ApiPropertyOptional({
    default: 0,
    description: 'Guests above the plan maximum',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  additionalGuests?: number;

  @ApiPropertyOptional({ description: 'Override the plan hourly rate' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  pricePerHour?: number;

  @ApiPropertyOptional({ description: 'Override the plan max guests' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  maxGuests?: number;

  @ApiPropertyOptional({ description: 'Override the plan extra-guest price' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  pricePerGuest?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  notes?: string;

  @ApiPropertyOptional({
    type: PaymentInputDto,
    description: 'Record an initial payment',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentInputDto)
  payment?: PaymentInputDto;
}

export class UpdateBookingDto extends PartialType(
  OmitType(CreateBookingDto, ['payment'] as const),
) {}

export class ListBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({ enum: DateRange })
  @IsOptional()
  @IsEnum(DateRange)
  range?: DateRange;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'With range=custom',
  })
  @IsOptional()
  @Matches(DATE_RULE)
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'With range=custom',
  })
  @IsOptional()
  @Matches(DATE_RULE)
  to?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';
}

export class BookingCountsQueryDto extends OmitType(ListBookingsQueryDto, [
  'status',
  'page',
  'limit',
  'sort',
] as const) {}
