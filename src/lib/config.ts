import 'server-only';
import { z } from 'zod';
import { isAbsolute, resolve } from 'node:path';

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

/**
 * Absolute location of the private file store.
 *
 * A relative LOCAL_STORAGE_DIR is resolved against the project root, not the
 * process working directory. Without this, starting the app from a different
 * cwd (systemd unit, container WORKDIR, /tmp during a test) would silently point
 * at a different directory and every stored original would look missing.
 *
 * This directory must live outside .next/build output, public/, and temp paths.
 */
export const STORAGE_ROOT: string = (() => {
  const configured = env.LOCAL_STORAGE_DIR;
  // Anchor relative paths to this file's own location (src/lib -> project root)
  // rather than process.cwd(), so the store is found no matter how the process
  // is launched (npm script, systemd unit, container with a different WORKDIR).
  const projectRoot = resolve(__dirname, '..', '..');
  const absolute = isAbsolute(configured) ? configured : resolve(projectRoot, configured);
  const forbidden = ['/.next/', '/public/', '/tmp/', '/node_modules/'];
  const normalised = `${absolute.replaceAll('\\', '/')}/`;
  for (const fragment of forbidden) {
    if (normalised.includes(fragment)) {
      throw new Error(`LOCAL_STORAGE_DIR must not point inside ${fragment.replaceAll('/', '')} (disposable or public). Use a dedicated data directory and back it up.`);
    }
  }
  return absolute;
})();

export function requireDatabaseUrl(): string {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured. Follow the local setup steps in README.md.');
  return env.DATABASE_URL;
}

export function requireSessionSecret(): string {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.startsWith('replace-')) throw new Error('SESSION_SECRET is not configured. Add a random secret of at least 32 characters to .env.local.');
  return env.SESSION_SECRET;
}
