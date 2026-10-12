/**
 * Access/refresh token flow against the real database configured in .env.
 * Requires MySQL running and `npm run seed` to have been run once.
 * Creates sign-in sessions for the seeded admin and revokes them before finishing.
 * Note: the "sign out other devices" test also signs that admin out of any open
 * dashboard or app sessions on this database.
 */
process.env.TZ ??= 'Asia/Kolkata';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request, { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

interface TokenBody {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  user: { email: string };
}

const credentials = () => ({
  email: process.env.SEED_ADMIN_EMAIL,
  password: process.env.SEED_ADMIN_PASSWORD,
});

/** The `nt_refresh=...` pair from a Set-Cookie header, ready for a Cookie header. */
const refreshCookie = (res: Response) => {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('nt_refresh='));
  return { raw: cookie ?? '', pair: cookie?.split(';')[0] ?? '' };
};

describe('Auth sessions (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(moduleFixture.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const webLogin = async () => {
    const res = await http()
      .post('/api/auth/login')
      .send(credentials())
      .expect(200);
    return { body: res.body as TokenBody, cookie: refreshCookie(res) };
  };

  const mobileLogin = async () => {
    const res = await http()
      .post('/api/auth/login')
      .set('X-Client', 'mobile')
      .send(credentials())
      .expect(200);
    return res.body as TokenBody;
  };

  it('web login: refresh token only in an httpOnly cookie scoped to /api/auth', async () => {
    const { body, cookie } = await webLogin();
    expect(body.accessToken).toBeTruthy();
    expect(body.expiresIn).toBe(15 * 60);
    expect(body.refreshToken).toBeUndefined();
    expect(cookie.raw).toMatch(/HttpOnly/i);
    expect(cookie.raw).toMatch(/Path=\/api\/auth/i);
    expect(cookie.raw).toMatch(/SameSite=Strict/i);
    expect(cookie.raw).toMatch(/Max-Age=604800/);
    await http().post('/api/auth/logout').set('Cookie', cookie.pair);
  });

  it('web refresh: rotates the cookie and the new access token works', async () => {
    const { cookie } = await webLogin();
    const res = await http()
      .post('/api/auth/refresh')
      .set('Cookie', cookie.pair)
      .expect(200);
    const body = res.body as TokenBody;
    const next = refreshCookie(res);
    expect(body.refreshToken).toBeUndefined();
    expect(next.pair).toBeTruthy();
    expect(next.pair).not.toBe(cookie.pair);

    await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    await http().post('/api/auth/logout').set('Cookie', next.pair);
  });

  it('cookie refresh: refuses unknown origins and never puts the token in the body', async () => {
    const { cookie } = await webLogin();
    await http()
      .post('/api/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookie.pair)
      .expect(403);

    const res = await http()
      .post('/api/auth/refresh')
      .set('X-Client', 'mobile')
      .set('Cookie', cookie.pair)
      .expect(200);
    expect((res.body as TokenBody).refreshToken).toBeUndefined();
    await http()
      .post('/api/auth/logout')
      .set('Cookie', refreshCookie(res).pair);
  });

  it('mobile: refresh token in the body, rotated on each refresh', async () => {
    const login = await mobileLogin();
    expect(login.refreshToken).toBeTruthy();

    const res = await http()
      .post('/api/auth/refresh')
      .send({ refreshToken: login.refreshToken })
      .expect(200);
    const body = res.body as TokenBody;
    expect(body.refreshToken).toBeTruthy();
    expect(body.refreshToken).not.toBe(login.refreshToken);
    expect(res.headers['set-cookie']).toBeUndefined();

    await http()
      .post('/api/auth/logout')
      .send({ refreshToken: body.refreshToken })
      .expect(204);
  });

  it('a replayed old refresh token revokes the whole session', async () => {
    const t1 = (await mobileLogin()).refreshToken!;
    const r2 = await http()
      .post('/api/auth/refresh')
      .send({ refreshToken: t1 })
      .expect(200);
    const t2 = (r2.body as TokenBody).refreshToken!;
    const r3 = await http()
      .post('/api/auth/refresh')
      .send({ refreshToken: t2 })
      .expect(200);
    const { refreshToken: t3, accessToken } = r3.body as TokenBody;

    // t1 is two rotations old — outside the grace window for parallel refreshes.
    await http()
      .post('/api/auth/refresh')
      .send({ refreshToken: t1 })
      .expect(401);
    await http()
      .post('/api/auth/refresh')
      .send({ refreshToken: t3 })
      .expect(401);
    await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('logout revokes the session immediately, including its access token', async () => {
    const login = await mobileLogin();
    await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.accessToken}`)
      .expect(200);

    await http()
      .post('/api/auth/logout')
      .send({ refreshToken: login.refreshToken })
      .expect(204);

    await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.accessToken}`)
      .expect(401);
    await http()
      .post('/api/auth/refresh')
      .send({ refreshToken: login.refreshToken })
      .expect(401);
  });

  it('rejects a refresh token used as an access token', async () => {
    const login = await mobileLogin();
    await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.refreshToken}`)
      .expect(401);
    await http()
      .post('/api/auth/logout')
      .send({ refreshToken: login.refreshToken });
  });

  it('lists sessions and signs out other devices', async () => {
    const a = await mobileLogin();
    const b = await mobileLogin();
    const list = await http()
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    const sessions = list.body as { current: boolean }[];
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions.length).toBeGreaterThanOrEqual(2);

    await http()
      .post('/api/auth/sessions/revoke-others')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(401);
    await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    await http()
      .post('/api/auth/logout')
      .send({ refreshToken: a.refreshToken });
  });

  it('refresh without any token is 401', () =>
    http().post('/api/auth/refresh').expect(401));
});
