import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AuthSession } from '../auth/auth-session.entity';
import { Booking } from '../bookings/booking.entity';
import { GalleryImage, Review, TurfService } from '../content/content.entities';
import { Enquiry } from '../enquiries/enquiry.entity';
import { Invoice } from '../invoices/invoice.entity';
import { Payment } from '../payments/payment.entity';
import { PricingPlan } from '../pricing/pricing-plan.entity';
import { User } from '../users/user.entity';

export const ENTITIES = [
  User,
  AuthSession,
  Booking,
  Payment,
  Invoice,
  PricingPlan,
  Enquiry,
  TurfService,
  GalleryImage,
  Review,
];

/**
 * TLS for hosted MySQL (e.g. Aiven): DB_SSL_CA holds the provider's CA certificate
 * (PEM, newlines may be written as \n); DB_SSL=true alone uses the system CAs.
 */
function sslConfig(env: (key: string) => string | undefined) {
  const ca = env('DB_SSL_CA')?.replace(/\\n/g, '\n');
  if (ca) return { ca, rejectUnauthorized: true };
  return env('DB_SSL') === 'true' ? { rejectUnauthorized: true } : undefined;
}

export function databaseConfig(
  env: (key: string) => string | undefined,
): TypeOrmModuleOptions {
  return {
    type: 'mysql',
    host: env('DB_HOST') ?? 'localhost',
    port: Number(env('DB_PORT') ?? 3306),
    username: env('DB_USER'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME'),
    entities: ENTITIES,
    synchronize: env('DB_SYNC') === 'true',
    charset: 'utf8mb4_unicode_ci',
    // Keep DATE columns as 'YYYY-MM-DD' strings so time zones can't shift them.
    dateStrings: ['DATE'],
    timezone: 'local',
    logging: env('DB_LOGGING') === 'true' ? 'all' : ['error'],
  };
}
