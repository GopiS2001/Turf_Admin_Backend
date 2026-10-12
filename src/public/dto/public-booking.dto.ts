import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { DATE_RULE } from '../../bookings/dto/booking.dto';
import {
  CLOSE_HOUR,
  MAX_BOOKING_MINUTES,
  OPEN_HOUR,
} from '../../common/utils/time';
import { PHONE_RULE } from '../../users/dto/user.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Matches the website's `BookingRequest` type. */
export class PublicBookingDto {
  @ApiProperty({ example: '2026-10-10' })
  @Matches(DATE_RULE, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiProperty({ example: 19, minimum: OPEN_HOUR, maximum: CLOSE_HOUR - 1 })
  @Type(() => Number)
  @IsInt()
  @Min(OPEN_HOUR)
  @Max(CLOSE_HOUR - 1)
  startHour: number;

  @ApiProperty({ example: 2, minimum: 1, maximum: MAX_BOOKING_MINUTES / 60 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_BOOKING_MINUTES / 60)
  hours: number;

  @ApiProperty({ example: 12, description: 'Total players' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  guests: number;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '98765 43210' })
  @Transform(trim)
  @Matches(PHONE_RULE, {
    message: 'phone must be a valid 10-digit Indian mobile number',
  })
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @ValidateIf((o: PublicBookingDto) => o.email !== '')
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  notes?: string;
}
