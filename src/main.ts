// Must run before anything creates a Date: all booking times are local to the turf.
process.env.TZ ??= 'Asia/Kolkata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = configureApp(
    await NestFactory.create<NestExpressApplication>(AppModule),
  );
  // Behind a hosting proxy (Railway), read the client IP from X-Forwarded-For so
  // rate limits apply per visitor instead of to everyone at once.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

  const swagger = new DocumentBuilder()
    .setTitle('90s Turf API')
    .setDescription(
      'Bookings, payments, invoices, users and dashboard for 90s Turf',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swagger),
  );

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(
    `API ready on http://localhost:${port}/api  ·  docs at /api/docs`,
    'Bootstrap',
  );
}

void bootstrap();
