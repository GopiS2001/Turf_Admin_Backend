import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Match } from '../../common/decorators/match.decorator';
import {
  CreateUserDto,
  PASSWORD_MESSAGE,
  PASSWORD_RULE,
} from '../../users/dto/user.dto';

export class LoginDto {
  @ApiProperty({ example: 'admin@90sturf.in' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  password: string;
}

/** Mobile apps send the refresh token here; browsers send nothing and rely on the cookie. */
export class RefreshDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;

  @ApiProperty()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword: string;

  @ApiProperty()
  @Match('newPassword', { message: 'confirmPassword must match newPassword' })
  confirmPassword: string;
}

/** Fields a signed-in user may change on their own profile. */
export class UpdateProfileDto extends PickType(CreateUserDto, [
  'name',
  'phone',
  'address',
  'city',
  'state',
  'country',
  'zipCode',
] as const) {}
