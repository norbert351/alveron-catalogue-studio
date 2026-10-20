import 'server-only';
import { z } from 'zod';

const blankToUndefined = (value: unknown) => value === '' ? undefined : value;
const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  SESSION_SECRET: z.preprocess(blankToUndefined, z.string().min(32).optional()),
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./.local-data/private'),
  S3_BUCKET: optionalString,
  S3_REGION: optionalString,
  S3_ENDPOINT: z.preprocess(blankToUndefined, z.string().url().optional()),
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
  IMAGE_GENERATION_PROVIDER: z.string().default('none'),
});

export const env = configSchema.parse(process.env);

export function requireDatabaseUrl(): string {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured. Follow the local setup steps in README.md.');
  return env.DATABASE_URL;
}

export function requireSessionSecret(): string {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.startsWith('replace-')) throw new Error('SESSION_SECRET is not configured. Add a random secret of at least 32 characters to .env.local.');
  return env.SESSION_SECRET;
}
