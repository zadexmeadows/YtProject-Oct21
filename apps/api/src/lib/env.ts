import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const projectRoot = process.env.INIT_CWD ?? path.resolve(process.cwd(), '../..');
const resolveProjectPath = (value: string) =>
  path.isAbsolute(value) ? value : path.resolve(projectRoot, value);

const optionalDomainSchema = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(32),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  EXPORT_DIR: z.string().min(1).default('./storage/exports').transform(resolveProjectPath),
  COOKIE_DOMAIN: optionalDomainSchema,
  FIREBASE_API_KEY: z.string().optional(),
  FIREBASE_AUTH_DOMAIN: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  FIREBASE_APP_ID: z.string().optional(),
  FIREBASE_VAPID_KEY: z.string().optional()
});

export const env = envSchema.parse(process.env);
