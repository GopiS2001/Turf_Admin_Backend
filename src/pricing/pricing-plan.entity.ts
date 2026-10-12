import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { PlanCode } from '../common/enums';
import { decimal } from '../common/utils/decimal.transformer';

@Entity('pricing_plans')
export class PricingPlan {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: PlanCode, unique: true })
  code: PlanCode;

  @Column({ length: 60 })
  name: string;

  @Column({ length: 80 })
  timing: string;

  @Column({
    name: 'price_per_hour',
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimal,
  })
  pricePerHour: number;

  @Column({ name: 'max_guests', type: 'int' })
  maxGuests: number;

  @Column({
    name: 'price_per_guest',
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimal,
  })
  pricePerGuest: number;

  @Column({ type: 'json' })
  features: string[];

  @Column({ default: false })
  popular: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
