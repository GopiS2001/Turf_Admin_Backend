import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BookingStatus, PaymentStatus, PaymentType } from '../common/enums';
import { decimal } from '../common/utils/decimal.transformer';
import { Invoice } from '../invoices/invoice.entity';
import { Payment } from '../payments/payment.entity';
import { User } from '../users/user.entity';

const money = {
  type: 'decimal',
  precision: 10,
  scale: 2,
  transformer: decimal,
} as const;

@Entity('bookings')
@Index(['bookingDate', 'timeIn'])
export class Booking {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'booking_code', length: 20, unique: true })
  bookingCode: string;

  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  @Column({ name: 'customer_name', length: 100 })
  customerName: string;

  @Column({ name: 'customer_phone', length: 20 })
  customerPhone: string;

  @Column({
    name: 'customer_email',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  customerEmail: string | null;

  /** YYYY-MM-DD */
  @Column({ name: 'booking_date', type: 'date' })
  bookingDate: string;

  /** HH:mm:ss — `24:00:00` means midnight */
  @Column({ name: 'time_in', type: 'time' })
  timeIn: string;

  @Column({ name: 'time_out', type: 'time' })
  timeOut: string;

  @Column({
    name: 'total_hours',
    type: 'decimal',
    precision: 4,
    scale: 1,
    transformer: decimal,
  })
  totalHours: number;

  @Column({ name: 'price_per_hour', ...money })
  pricePerHour: number;

  @Column({ name: 'turf_amount', ...money })
  turfAmount: number;

  @Column({ name: 'max_guests', type: 'int' })
  maxGuests: number;

  @Column({ name: 'price_per_guest', ...money })
  pricePerGuest: number;

  @Column({ name: 'additional_guests', type: 'int', default: 0 })
  additionalGuests: number;

  @Column({ name: 'additional_guest_amount', ...money })
  additionalGuestAmount: number;

  @Column({ name: 'total_amount', ...money })
  totalAmount: number;

  @Column({ name: 'amount_paid', ...money, default: 0 })
  amountPaid: number;

  @Column({
    type: 'enum',
    enum: BookingStatus,
    default: BookingStatus.UPCOMING,
  })
  status: BookingStatus;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  paymentStatus: PaymentStatus;

  /** Method of the most recent payment. */
  @Column({
    name: 'payment_type',
    type: 'enum',
    enum: PaymentType,
    nullable: true,
  })
  paymentType: PaymentType | null;

  @Column({
    name: 'transaction_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  transactionId: string | null;

  @Column({ name: 'payment_date', type: 'datetime', nullable: true })
  paymentDate: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ADMIN' })
  source: 'ADMIN' | 'WEBSITE' | 'MOBILE';

  @Column({
    name: 'booked_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  bookedAt: Date;

  @OneToMany(() => Payment, (p) => p.booking)
  payments?: Payment[];

  @OneToOne(() => Invoice, (i) => i.booking)
  invoice?: Invoice;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
