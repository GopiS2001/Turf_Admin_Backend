/**
 * Seeds the database. Safe to run repeatedly — existing rows are left alone.
 *   npm run seed          → admin user, pricing plans, services, gallery, reviews
 *   npm run seed -- --demo → also sample customers, bookings and payments
 */
process.env.TZ ??= 'Asia/Kolkata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { Booking } from '../bookings/booking.entity';
import { BookingsService } from '../bookings/bookings.service';
import {
  AccountStatus,
  PaymentKind,
  PaymentType,
  PlanCode,
  Role,
} from '../common/enums';
import { addDays, toISODate } from '../common/utils/time';
import { GalleryImage, Review, TurfService } from '../content/content.entities';
import { PricingPlan } from '../pricing/pricing-plan.entity';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

const log = new Logger('Seed');

const PLANS: Partial<PricingPlan>[] = [
  {
    code: PlanCode.WEEKDAY_DAY,
    name: 'Weekday Day',
    timing: 'Mon – Fri · 6 AM – 6 PM',
    pricePerHour: 800,
    maxGuests: 14,
    pricePerGuest: 50,
    features: [
      'Up to 14 players',
      'Balls & bibs included',
      'Changing rooms',
      'Free parking',
    ],
    popular: false,
    sortOrder: 1,
  },
  {
    code: PlanCode.WEEKDAY_NIGHT,
    name: 'Weekday Night',
    timing: 'Mon – Fri · 6 PM – 12 AM',
    pricePerHour: 1200,
    maxGuests: 14,
    pricePerGuest: 50,
    features: [
      'Up to 14 players',
      'LED floodlights',
      'Balls & bibs included',
      'Drinking water & seating',
    ],
    popular: true,
    sortOrder: 2,
  },
  {
    code: PlanCode.WEEKEND,
    name: 'Weekend',
    timing: 'Sat – Sun · 6 AM – 12 AM',
    pricePerHour: 1400,
    maxGuests: 14,
    pricePerGuest: 50,
    features: [
      'Up to 14 players',
      'Floodlights after 6 PM',
      'Balls & bibs included',
      'Scoreboard',
    ],
    popular: false,
    sortOrder: 3,
  },
];

const SERVICES: Partial<TurfService>[] = [
  {
    slug: 'football',
    icon: 'football',
    title: '5s & 7s Football',
    description:
      'FIFA-grade artificial turf with shock pads, marked for 5-a-side and 7-a-side games. Balls and bibs on the house.',
  },
  {
    slug: 'cricket',
    icon: 'cricket',
    title: 'Box Cricket',
    description:
      'Fully netted box cricket with stumps, tennis balls and bats ready. Perfect for quick 6-over battles after work.',
  },
  {
    slug: 'tournaments',
    icon: 'trophy',
    title: 'Tournaments & Leagues',
    description:
      'Weekend knockouts and monthly leagues with fixtures, referees, scoreboards and trophies handled for you.',
  },
  {
    slug: 'corporate',
    icon: 'briefcase',
    title: 'Corporate Matches',
    description:
      'Team-building fixtures for offices with block bookings, GST invoices, refreshments and photography add-ons.',
  },
  {
    slug: 'parties',
    icon: 'cake',
    title: 'Birthday Games',
    description:
      "Kids' and adults' birthday football with a coach-run session, decorations area and cake time pitch-side.",
  },
  {
    slug: 'coaching',
    icon: 'whistle',
    title: 'Coaching Camps',
    description:
      'Weekend skills camps for ages 6–16 run by licensed coaches — ball control, passing, fitness and match play.',
  },
].map((s, i) => ({ ...s, sortOrder: i + 1, active: true }));

const GALLERY: [number, string, string, number][] = [
  [2, 'Player dribbling the ball across the green turf', 'Matches', 818],
  [5, 'Striker taking a shot during an evening match', 'Matches', 2105],
  [1, 'Orange football boots on the turf corner marking', 'Turf', 933],
  [7, 'Red cricket ball resting in the grass', 'Cricket', 937],
  [13, 'Trophy and match ball at the tournament final', 'Events', 788],
  [3, 'Foot on the ball before kick-off', 'Matches', 1867],
  [4, 'Freshly marked white line on the turf', 'Turf', 933],
  [8, 'Cricket ground under floodlights', 'Cricket', 808],
  [11, 'Close tackle on the futsal court', 'Matches', 1399],
  [6, 'Match ball on the centre of the pitch', 'Turf', 933],
  [10, 'Player volleying the ball in the sky-lit evening', 'Events', 1810],
  [12, 'Boots and ball ready on the turf', 'Turf', 1750],
  [9, 'Classic black-and-white football on the grass', 'Turf', 933],
];

const REVIEWS: Partial<Review>[] = [
  {
    name: 'Karthik R.',
    role: 'Weekly 7s player',
    rating: 5,
    comment:
      'Best turf around here. The grass is thick, the lights are bright, and booking a slot takes less than a minute. Our Thursday night game has a permanent home now.',
  },
  {
    name: 'Priya S.',
    role: 'Organised a birthday game',
    rating: 5,
    comment:
      "Hosted my son's 10th birthday here. The staff set up everything, the coach kept 20 kids busy for two hours and the parents loved the seating area.",
  },
  {
    name: 'Arun M.',
    role: 'Corporate team captain',
    rating: 5,
    comment:
      'We run our monthly office league here. Invoices are on time, the slots never clash and the turf is always clean. Highly recommended for teams.',
  },
  {
    name: 'Vignesh K.',
    role: 'Box cricket regular',
    rating: 4,
    comment:
      'Box cricket nets are solid and the pitch plays true. Weekend evenings fill up fast, so book early — the online slot grid makes that easy.',
  },
  {
    name: 'Sneha J.',
    role: 'Coaching camp parent',
    rating: 5,
    comment:
      'My daughter has been at the weekend camp for three months. The coaches are patient and her confidence with the ball has grown a lot.',
  },
].map((r, i) => ({ ...r, published: true, sortOrder: i + 1 }));

async function seedBase(ds: DataSource, users: UsersService) {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env');

  if (await ds.getRepository(User).existsBy({ email: email.toLowerCase() })) {
    log.log(`Admin ${email} already exists — skipped`);
  } else {
    await users.create({
      name: process.env.SEED_ADMIN_NAME ?? 'Turf Admin',
      email: email.toLowerCase(),
      password,
      confirmPassword: password,
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      country: 'India',
    });
    log.log(`Created admin ${email}`);
  }

  const plans = ds.getRepository(PricingPlan);
  for (const plan of PLANS) {
    if (!(await plans.existsBy({ code: plan.code })))
      await plans.save(plans.create(plan));
  }
  log.log(`Pricing plans: ${await plans.count()}`);

  const services = ds.getRepository(TurfService);
  for (const s of SERVICES) {
    if (!(await services.existsBy({ slug: s.slug })))
      await services.save(services.create(s));
  }
  log.log(`Services: ${await services.count()}`);

  const gallery = ds.getRepository(GalleryImage);
  if ((await gallery.count()) === 0) {
    await gallery.save(
      GALLERY.map(([n, alt, category, height], i) =>
        gallery.create({
          src: `/images/gallery/g${n}.jpg`,
          alt,
          category,
          width: 1400,
          height,
          sortOrder: i + 1,
        }),
      ),
    );
  }
  log.log(`Gallery images: ${await gallery.count()}`);

  const reviews = ds.getRepository(Review);
  if ((await reviews.count()) === 0)
    await reviews.save(REVIEWS.map((r) => reviews.create(r)));
  log.log(`Reviews: ${await reviews.count()}`);
}

async function seedDemo(
  ds: DataSource,
  users: UsersService,
  bookings: BookingsService,
) {
  if ((await ds.getRepository(Booking).count()) > 0) {
    log.log('Bookings already exist — demo data skipped');
    return;
  }

  const customers = [
    {
      name: 'Karthik Raja',
      email: 'karthik@example.com',
      phone: '9876501234',
      city: 'Salem',
    },
    {
      name: 'Priya Shankar',
      email: 'priya@example.com',
      phone: '9876502345',
      city: 'Salem',
    },
    {
      name: 'Arun Mohan',
      email: 'arun@example.com',
      phone: '9876503456',
      city: 'Attur',
    },
  ];
  const created: User[] = [];
  for (const c of customers) {
    const existing = await ds.getRepository(User).findOneBy({ email: c.email });
    created.push(
      existing ??
        (await users.create({
          ...c,
          state: 'Tamil Nadu',
          country: 'India',
          zipCode: '636017',
          role: Role.CUSTOMER,
        })),
    );
  }

  const today = new Date();
  const day = (offset: number) => toISODate(addDays(today, offset));
  // [dayOffset, timeIn, timeOut, customerIdx, extraGuests, payment?]
  const plan: [
    number,
    string,
    string,
    number,
    number,
    [number, PaymentType] | null,
  ][] = [
    [-20, '18:00', '20:00', 0, 0, [2400, PaymentType.UPI]],
    [-15, '07:00', '09:00', 1, 2, [1700, PaymentType.CASH]],
    [-9, '19:00', '21:00', 2, 0, [2400, PaymentType.BANK_TRANSFER]],
    [-4, '20:00', '22:00', 0, 4, [1000, PaymentType.UPI]],
    [-1, '17:00', '19:00', 1, 0, [2000, PaymentType.CASH]],
    [1, '19:00', '21:00', 2, 0, [1000, PaymentType.UPI]],
    [2, '06:00', '08:00', 0, 0, null],
    [3, '18:00', '19:30', 1, 3, [500, PaymentType.UPI]],
    [5, '20:00', '22:00', 2, 0, null],
  ];

  for (const [offset, timeIn, timeOut, idx, extra, pay] of plan) {
    const c = created[idx];
    try {
      await bookings.create({
        userId: c.id,
        customerName: c.name,
        customerPhone: c.phone ?? '9876500000',
        customerEmail: c.email,
        bookingDate: day(offset),
        timeIn,
        timeOut,
        additionalGuests: extra,
        payment: pay
          ? {
              amount: pay[0],
              paymentType: pay[1],
              kind: PaymentKind.ADVANCE,
              transactionId:
                pay[1] === PaymentType.CASH
                  ? undefined
                  : `TXN${Date.now()}${idx}`,
              paidAt: addDays(today, Math.min(offset, 0)),
            }
          : undefined,
      });
    } catch (err) {
      log.warn(
        `Skipped demo booking on ${day(offset)} ${timeIn}: ${(err as Error).message}`,
      );
    }
  }

  // One cancelled booking for the Cancelled tab.
  const toCancel = await bookings.create({
    customerName: 'Walk-in Team',
    customerPhone: '9876509999',
    bookingDate: day(4),
    timeIn: '10:00',
    timeOut: '11:00',
  });
  await bookings.cancel(toCancel.id);

  await bookings.syncStatuses();
  log.log(`Demo bookings: ${await ds.getRepository(Booking).count()}`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const ds = app.get(DataSource);
    const users = app.get(UsersService);
    await seedBase(ds, users);
    if (process.argv.includes('--demo'))
      await seedDemo(ds, users, app.get(BookingsService));
    log.log('Done');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
