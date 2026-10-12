import { INestApplication, ValidationPipe } from '@nestjs/common';
import { allowedOrigins } from './config/cors';

/** Shared by main.ts and the e2e tests so both run the same configuration. */
export function configureApp<T extends INestApplication>(app: T): T {
  app.setGlobalPrefix('api');
  // credentials: browsers send the httpOnly refresh-token cookie to /api/auth.
  app.enableCors({ origin: allowedOrigins(), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  return app;
}
