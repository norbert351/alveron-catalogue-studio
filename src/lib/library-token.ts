import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { getPool } from './db';

/**
 * Read-only bearer tokens for external retrieval (ChatGPT).
 *
 * Deliberately separate from browser sessions:
 *  - a token authenticates a machine, a session authenticates a person;
 *  - a token can be revoked without logging the owner out, and vice versa;
 *  - a token carries ONLY the 'library:read' scope, so even a leaked token
 *    cannot upload, edit or delete anything.
 *
 * Only sha256(token) is stored. The plaintext is returned once at creation and
 * never persisted, so a database dump does not yield a usable credential.
 */

export const TOKEN_PREFIX = 'alv_lib_';
export const TOKEN_SCOPE = 'library:read';

export type TokenOwner = { tokenId: string; label: string; scope: string };

function digest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Generate a new token. Returns the plaintext ONCE; store only this value back to the caller. */
export function generateToken(): { token: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: digest(token) };
}

/** Pull a bearer token out of the Authorization header. */
export function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const value = match?.[1]?.trim();
  if (!value) return null;
  // Constant shape check before touching the database: cheap rejection of junk.
  if (!value.startsWith(TOKEN_PREFIX) || value.length < 20) return null;
  return value;
}

/**
 * Validate a bearer token and record the use.
 *
 * Returns null for: missing header, malformed token, unknown token, revoked
 * token. Never throws on a bad token — the caller maps null to 401.
 *
 * Use accounting is best-effort: a failure to update counters must not deny a
 * legitimate read, so it is caught and ignored.
 */
export async function authenticateToken(request: Request): Promise<TokenOwner | null> {
  const token = bearerFrom(request);
  if (!token) return null;
  const pool = getPool();
  const result = await pool.query<{ id: string; label: string; scope: string }>(
    `SELECT id, label, scope FROM library_api_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [digest(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  await pool.query(
    'UPDATE library_api_tokens SET last_used_at = now(), use_count = use_count + 1 WHERE id = $1',
    [row.id],
  ).catch(() => undefined);
  return { tokenId: row.id, label: row.label, scope: row.scope };
}
