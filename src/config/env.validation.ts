import { parseDuration } from '../auth/auth.config';

const REQUIRED = [
  'DB_HOST',
  'DB_USER',
  'DB_NAME',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

const assertSecret = (name: string, value: unknown) => {
  const secret = String(value);
  if (secret.length < 32 || secret.startsWith('replace_with')) {
    throw new Error(
      `${name} must be a random string of at least 32 characters`,
    );
  }
};

const str = (value: unknown, fallback: string) =>
  typeof value === 'string' && value ? value : fallback;

/** Fail fast at startup when required settings are missing or unsafe. */
export function validateEnv(config: Record<string, unknown>) {
  const missing = REQUIRED.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')} (see .env.example)`,
    );
  }
  assertSecret('JWT_SECRET', config.JWT_SECRET);
  assertSecret('JWT_REFRESH_SECRET', config.JWT_REFRESH_SECRET);
  if (config.JWT_SECRET === config.JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET must be different from JWT_SECRET');
  }

  for (const key of ['JWT_ACCESS_EXPIRES_IN', 'JWT_REFRESH_EXPIRES_IN']) {
    parseDuration(str(config[key], '1s'));
  }

  const sameSite = str(config.COOKIE_SAMESITE, 'strict');
  if (!['strict', 'lax', 'none'].includes(sameSite)) {
    throw new Error('COOKIE_SAMESITE must be strict, lax or none');
  }
  const secure =
    str(config.COOKIE_SECURE, String(config.NODE_ENV === 'production')) ===
    'true';
  if (sameSite === 'none' && !secure) {
    throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
  }
  return config;
}
