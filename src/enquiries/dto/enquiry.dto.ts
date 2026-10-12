import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { EnquiryStatus } from '../../common/enums';
import { PHONE_RULE } from '../../users/dto/user.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateEnquiryDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty()
  @Transform(trim)
  @IsEmail()
  @MaxLength(150)
  email: string;

  @ApiProperty()
  @Transform(trim)
  @Matches(PHONE_RULE, {
    message: 'phone must be a valid 10-digit Indian mobile number',
  })
  phone: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  subject: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  message: string;
}

export class UpdateEnquiryDto {
  @ApiProperty({ enum: EnquiryStatus })
  @IsEnum(EnquiryStatus)
  status: EnquiryStatus;
}

export class ListEnquiriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EnquiryStatus })
  @IsOptional()
  @IsEnum(EnquiryStatus)
  status?: EnquiryStatus;
}
