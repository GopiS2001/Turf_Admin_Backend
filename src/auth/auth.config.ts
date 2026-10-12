import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';

const UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** '15m' / '7d' / '3600s' → milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `Invalid duration "${value}" — use a number followed by s, m, h or d (e.g. 15m, 7d)`,
    );
  }
  return Number(match[1]) * UNITS[match[2]];
}

/** Token lifetimes, secrets and refresh-cookie settings, read once from the environment. */
@Injectable()
export class AuthConfig {
  readonly accessSecret: string;
  readonly refreshSecret: string;
  readonly accessTtlMs: number;
  readonly refreshTtlMs: number;
  /** A replaced refresh token still works this long, so two tabs refreshing at once don't sign the user out. */
  readonly reuseGraceMs = 60_000;

  readonly cookieName = 'nt_refresh';
  private readonly cookieBase: CookieOptions;

  constructor(config: ConfigService) {
    this.accessSecret = config.getOrThrow<string>('JWT_SECRET');
    this.refreshSecret = config.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.accessTtlMs = parseDuration(
      config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
    );
    this.refreshTtlMs = parseDuration(
      config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    );

    const production = config.get<string>('NODE_ENV') === 'production';
    const sameSite = config.get<string>('COOKIE_SAMESITE', 'strict');
    this.cookieBase = {
      httpOnly: true,
      secure:
        config.get<string>('COOKIE_SECURE', String(production)) === 'true',
      sameSite: sameSite as CookieOptions['sameSite'],
      // Only sent to /api/auth/* (login, refresh, logout) — never to the rest of the API.
      path: '/api/auth',
      domain: config.get<string>('COOKIE_DOMAIN') || undefined,
    };
  }

  cookieOptions(): CookieOptions {
    return { ...this.cookieBase, maxAge: this.refreshTtlMs };
  }

  clearCookieOptions(): CookieOptions {
    return this.cookieBase;
  }
}
