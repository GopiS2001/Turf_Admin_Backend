import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingPlan } from './pricing-plan.entity';
import { PricingService } from './pricing.service';

@Module({
  imports: [TypeOrmModule.forFeature([PricingPlan])],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
