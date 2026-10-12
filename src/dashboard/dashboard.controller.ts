import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { DATE_RULE } from '../bookings/dto/booking.dto';
import { Roles } from '../common/decorators/auth.decorators';
import { DateRange, Role } from '../common/enums';
import { DashboardService } from './dashboard.service';

export class SummaryQueryDto {
  @ApiPropertyOptional({
    enum: DateRange,
    description: 'Omit for all-time totals',
  })
  @IsOptional()
  @IsEnum(DateRange)
  range?: DateRange;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_RULE)
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_RULE)
  to?: string;
}

export class LimitQueryDto {
  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 5;
}

export class MonthsQueryDto {
  @ApiPropertyOptional({ default: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months = 6;
}

@ApiTags('Dashboard')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@Query() q: SummaryQueryDto) {
    return this.dashboard.summary(q.range, q.from, q.to);
  }

  @Get('upcoming')
  upcoming(@Query() q: LimitQueryDto) {
    return this.dashboard.upcoming(q.limit);
  }

  @Get('revenue')
  revenue(@Query() q: MonthsQueryDto) {
    return this.dashboard.revenue(q.months);
  }
}
