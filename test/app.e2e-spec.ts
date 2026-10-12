/**
 * End-to-end checks against the real database configured in .env.
 * Requires MySQL running and `npm run seed` to have been run once.
 * Read-only: these tests don't create or change any records.
 */
process.env.TZ ??= 'Asia/Kolkata';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

describe('90s Turf API (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(moduleFixture.createNestApplication());
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: process.env.SEED_ADMIN_EMAIL,
        password: process.env.SEED_ADMIN_PASSWORD,
      })
      .expect(200);
    token = (res.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves public pricing in the website format', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/public/pricing')
      .expect(200);
    const plans = res.body as { id: string; pricePerHour: number }[];
    expect(plans.map((p) => p.id)).toEqual([
      'weekday-day',
      'weekday-night',
      'weekend',
    ]);
    expect(typeof plans[0].pricePerHour).toBe('number');
  });

  it('returns 18 hourly slots for a date', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/public/slots?date=2026-12-01')
      .expect(200);
    expect(res.body).toHaveLength(18);
  });

  it('rejects admin routes without a token', () =>
    request(app.getHttpServer()).get('/api/bookings').expect(401));

  it('rejects a wrong password', () =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: process.env.SEED_ADMIN_EMAIL, password: 'wrong-password' })
      .expect(401));

  it('lists bookings with pagination for an admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/bookings?limit=2')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toMatchObject({ meta: { page: 1, limit: 2 } });
  });

  it('validates booking input and strips unknown fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerName: 'X', timeIn: '7:15', unknown: true })
      .expect(400);
    const { message } = res.body as { message: string[] };
    expect(message).toEqual(
      expect.arrayContaining(['property unknown should not exist']),
    );
  });

  it('generates an invoice PDF for an admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/documents/invoice/1/pdf')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/INV-\d{4}-\d{4}\.pdf/);
  });

  it('rejects an invalid public document token', () =>
    request(app.getHttpServer())
      .get('/api/public/documents/invoice/not-a-token.pdf')
      .expect(404));

  it('returns dashboard totals', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard/summary?range=month')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty('totalBookings');
    expect(res.body).toHaveProperty('totalPayments');
  });
});
