import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Serve static HTML from /public
  app.use(express.static(join(process.cwd(), 'public')));
  await app.listen(3000);
}

bootstrap();
