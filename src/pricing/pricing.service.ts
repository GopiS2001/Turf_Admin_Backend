import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingPlan } from './pricing-plan.entity';
import { calculatePrice } from './pricing.calc';

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PricingPlan)
    private readonly plans: Repository<PricingPlan>,
  ) {}

  findAll() {
    return this.plans.find({ order: { sortOrder: 'ASC' } });
  }

  async quote(input: Omit<Parameters<typeof calculatePrice>[0], 'plans'>) {
    return calculatePrice({ ...input, plans: await this.findAll() });
  }
}
