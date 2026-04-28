import * as dotenv from 'dotenv';
import { join } from 'path';

// Load .env explicitly from the running directory (where the exe is)
const envPath = join(process.cwd(), '.env');
console.log(`[DEBUG] Loading .env from: ${envPath}`);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn('[DEBUG] Warning: .env file not found or failed to load. Checking bundled env...');
  // Fallback: try loading without path (defaults to cwd, but maybe standard method works better if file missing)
  // Actually, if missing on disk, we might rely on system envs.
} else {
  console.log('[DEBUG] .env loaded successfully.');
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';

async function bootstrap() {
  console.log('[DEBUG] Starting bootstrap...');

  if (!process.env.GOOGLE_CREDENTIALS_JSON) {
    console.error('[ERROR] GOOGLE_CREDENTIALS_JSON is missing from environment variables!');
    console.error('Current keys:', Object.keys(process.env).filter(k => !k.startsWith('npm_')));
  }

  const app = await NestFactory.create(AppModule);

  // Serve static HTML from /public
  app.use(express.static(join(__dirname, '..', 'public')));
  app.use(express.static(join(__dirname, '..', 'public')));
  const port = 3500;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);

  // Auto-launch Chrome in App Mode (Windows)
  const { exec } = require('child_process');
  const url = `http://localhost:${port}`;

  console.log('[DEBUG] Attempting to launch UI window...');
  exec(`start chrome --app=${url}`, (err) => {
    if (err) {
      console.error('[DEBUG] Failed to launch Chrome. Trying Edge...');
      // Fallback to Edge if Chrome is missing
      exec(`start msedge --app=${url}`, (err2) => {
        if (err2) {
          console.error('[DEBUG] Failed to launch Edge. Opening default browser...');
          exec(`start ${url}`);
        }
      });
    }
  });
}

bootstrap().catch(err => {
  console.error('Fatal error during startup:', err);
  // Prevent console from closing immediately on error
  setInterval(() => { }, 1000);
});
