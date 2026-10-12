import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Booking } from '../bookings/booking.entity';
import { InvoiceStatus } from '../common/enums';
import { decimal } from '../common/utils/decimal.transformer';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn()
  id: number;

  /** INV-2026-0001 */
  @Column({ name: 'invoice_code', length: 20, unique: true })
  invoiceCode: string;

  /** Random secret used in public PDF links (shared by WhatsApp/email). */
  @Column({
    name: 'share_token',
    type: 'varchar',
    length: 64,
    unique: true,
    nullable: true,
    select: false,
  })
  shareToken: string | null;

  @Column({ name: 'booking_id', type: 'int', unique: true })
  bookingId: number;

  @OneToOne('Booking', 'invoice', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking?: Booking;

  @Column({ name: 'customer_name', length: 100 })
  customerName: string;

  @Column({ name: 'invoice_date', type: 'datetime' })
  invoiceDate: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2, transformer: decimal })
  amount: number;

  @Column({
    name: 'paid_amount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimal,
    default: 0,
  })
  paidAmount: number;

  @Column({ name: 'paid_at', type: 'datetime', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.UNPAID })
  status: InvoiceStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
