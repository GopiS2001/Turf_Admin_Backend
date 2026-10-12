import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Match } from '../../common/decorators/match.decorator';
import { AccountStatus, Role } from '../../common/enums';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/;
export const PASSWORD_MESSAGE =
  'Password must be 8–64 characters with an uppercase letter, a lowercase letter and a number';
export const PHONE_RULE = /^(\+91[\s-]?)?[6-9]\d{4}\s?\d{5}$/;

export class CreateUserDto {
  @ApiProperty({ example: 'Karthik R' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'karthik@example.com' })
  @Transform(lower)
  @IsEmail()
  @MaxLength(150)
  email: string;

  @ApiPropertyOptional({ example: '98765 43210' })
  @IsOptional()
  @Transform(trim)
  @Matches(PHONE_RULE, {
    message: 'phone must be a valid 10-digit Indian mobile number',
  })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional({ example: 'India' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  country?: string;

  @ApiPropertyOptional({ example: '636017' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9\s-]{3,12}$/, {
    message: 'zipCode must be a valid postal code',
  })
  zipCode?: string;

  /** Only admins sign in, so only admins have a password. Ignored for customers. */
  @ApiPropertyOptional({
    example: 'Secret@123',
    description: 'Required when role is ADMIN',
  })
  @ValidateIf((o: CreateUserDto) => o.role === Role.ADMIN)
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password?: string;

  @ApiPropertyOptional({
    example: 'Secret@123',
    description: 'Required when role is ADMIN',
  })
  @ValidateIf((o: CreateUserDto) => o.role === Role.ADMIN)
  @Match('password', { message: 'confirmPassword must match password' })
  confirmPassword?: string;

  @ApiPropertyOptional({ enum: Role, default: Role.CUSTOMER })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: AccountStatus, default: AccountStatus.ACTIVE })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;
}

/** All fields optional; password + confirmPassword only validated when a new password is sent (admins only). */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'confirmPassword'] as const),
) {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password?: string;

  @ApiPropertyOptional()
  @ValidateIf((o: UpdateUserDto) => o.password !== undefined)
  @Match('password', { message: 'confirmPassword must match password' })
  confirmPassword?: string;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;
}
