import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Booking } from '../bookings/booking.entity';
import { PaymentKind, PaymentType } from '../common/enums';
import { decimal } from '../common/utils/decimal.transformer';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'booking_id', type: 'int' })
  bookingId: number;

  @ManyToOne('Booking', 'payments', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking?: Booking;

  /** Always positive; `kind` = REFUND means money returned to the customer. */
  @Column({ type: 'decimal', precision: 10, scale: 2, transformer: decimal })
  amount: number;

  @Column({ type: 'enum', enum: PaymentKind })
  kind: PaymentKind;

  @Column({ name: 'payment_type', type: 'enum', enum: PaymentType })
  paymentType: PaymentType;

  @Column({
    name: 'transaction_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  transactionId: string | null;

  @Column({ name: 'paid_at', type: 'datetime' })
  paidAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
