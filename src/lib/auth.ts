import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { compare } from 'bcryptjs';
import { env, requireSessionSecret } from './config';
import { getPool } from './db';
import { isSameOrigin as checkSameOrigin, type StudioRole } from './security-rules';

const COOKIE_NAME = 'alveron_studio_session';
const SESSION_HOURS = 12;

export type StudioUser = { id: string; email: string; name: string; role: StudioRole };

function digestToken(token: string): string {
  return createHmac('sha256', requireSessionSecret()).update(token).digest('hex');
}

export async function authenticate(email: string, password: string): Promise<StudioUser | null> {
  const result = await getPool().query<StudioUser & { password_hash: string }>(
    'SELECT id, email, name, role, password_hash FROM studio_users WHERE email = $1',
    [email.trim().toLowerCase()],
  );
  const row = result.rows[0];
  if (!row || !(await compare(password, row.password_hash))) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function startSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await getPool().query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, digestToken(token), expiresAt]);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) await getPool().query('DELETE FROM sessions WHERE token_hash = $1', [digestToken(token)]);
  jar.delete(COOKIE_NAME);
}

export async function getCurrentUser(): Promise<StudioUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const result = await getPool().query<StudioUser>(
    `SELECT u.id, u.email, u.name, u.role
       FROM sessions s JOIN studio_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [digestToken(token)],
  );
  return result.rows[0] ?? null;
}

export async function requireUser(): Promise<StudioUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export function isSameOrigin(request: Request): boolean {
  return checkSameOrigin(request.url, request.headers.get('origin'), request.headers.get('x-forwarded-host') ?? request.headers.get('host'), request.headers.get('x-forwarded-proto'));
}
