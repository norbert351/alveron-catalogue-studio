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
 * Resolution order for a relative LOCAL_STORAGE_DIR:
 *   1. ALVERON_PROJECT_ROOT   — explicit override for systemd/containers, where
 *                               you can set the project path precisely.
 *   2. process.cwd()          — how npm scripts and `next start` normally run.
 *
 * Neither __dirname (bundler-mangled inside server routes) nor a bare relative
 * path (cwd-dependent) is safe here: both can silently point the store at a
 * different directory, which would make every stored original look missing.
 *
 * The resolved directory must not sit inside build output, public assets, or a
 * temporary directory, because those are disposable or world-readable.
 */
export const STORAGE_ROOT: string = (() => {
  const configured = env.LOCAL_STORAGE_DIR;
  const base = process.env.ALVERON_PROJECT_ROOT
    ? resolve(process.env.ALVERON_PROJECT_ROOT)
    : process.cwd();
  const absolute = isAbsolute(configured) ? resolve(configured) : resolve(base, configured);
  const forbidden: Array<[string, string]> = [
    ['/.next/', '.next build output'],
    ['/public/', 'the public/ directory'],
    ['/tmp/', 'a temporary directory'],
    ['/node_modules/', 'node_modules'],
  ];
  const normalised = `${absolute.replaceAll('\\', '/')}/`;
  for (const [fragment, description] of forbidden) {
    if (normalised.includes(fragment)) {
      throw new Error(`LOCAL_STORAGE_DIR must not point inside ${description}. Use a dedicated, backed-up data directory (see README "Storage"). Resolved to: ${absolute}`);
    }
  }
  // A path that resolved to the filesystem root is always a configuration error.
  if (absolute === '/') {
    throw new Error('LOCAL_STORAGE_DIR resolved to the filesystem root. Set an absolute path or ALVERON_PROJECT_ROOT.');
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
