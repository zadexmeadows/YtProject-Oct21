import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const projectRoot = process.env.INIT_CWD ?? path.resolve(process.cwd(), '../..');
const resolveProjectPath = (value: string) =>
  path.isAbsolute(value) ? value : path.resolve(projectRoot, value);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  WORKER_ID: z.string().min(1).default(`worker-${process.pid}`),
  EXPORT_DIR: z.string().min(1).default('./storage/exports').transform(resolveProjectPath),
  HEADLESS_BROWSER: z.coerce.boolean().default(true),
  DEFAULT_CAPTURE_SPEED_MS: z.coerce.number().int().min(500).max(15000).default(1500),
  MAX_CONCURRENT_STREAMS: z.coerce.number().int().min(1).max(50).default(8),
  FIREBASE_PROJECT_ID: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional()
});

export const env = envSchema.parse(process.env);
