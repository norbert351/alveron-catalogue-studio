import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { hasStudioAccess } from '@/lib/security-rules';
import { TOKEN_PREFIX, generateToken } from '@/lib/library-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Owner-facing token management. These routes are session-authenticated (a
 * human in the app), never bearer-authenticated — a library token must not be
 * able to mint more tokens.
 */

export async function GET() {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const result = await getPool().query(
    `SELECT id, label, scope, created_at, last_used_at, use_count, revoked_at
       FROM library_api_tokens ORDER BY created_at DESC`,
  );
  return NextResponse.json({ tokens: result.rows }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { label?: string };
  const label = z.string().trim().min(1).max(120).safeParse(body.label ?? 'ChatGPT connector');
  if (!label.success) return NextResponse.json({ error: 'Give the token a short label.' }, { status: 400 });

  const { token, hash } = generateToken();
  const inserted = await getPool().query<{ id: string }>(
    `INSERT INTO library_api_tokens (label, token_hash, scope, created_by) VALUES ($1,$2,'library:read',$3) RETURNING id`,
    [label.data, hash, user!.id],
  );
  await getPool().query(
    `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, detail) VALUES ($1,'library.token_created','library_api_token',$2,$3)`,
    [user!.id, inserted.rows[0].id, JSON.stringify({ label: label.data, scope: 'library:read' })],
  ).catch(() => undefined);

  // The plaintext token is returned exactly once and never stored. If the owner
  // loses it, they revoke and create another.
  return NextResponse.json({
    id: inserted.rows[0].id,
    label: label.data,
    scope: 'library:read',
    token,
    warning: 'Copy this now. It is not stored and cannot be shown again.',
    header: `${TOKEN_PREFIX}… in Authorization: Bearer <token>`,
  }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Token not found.' }, { status: 404 });
  // Revoke, never delete: the audit trail of what was issued must survive.
  const result = await getPool().query(
    'UPDATE library_api_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id', [id],
  );
  if (!result.rowCount) return NextResponse.json({ error: 'Token not found or already revoked.' }, { status: 404 });
  await getPool().query(
    `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, detail) VALUES ($1,'library.token_revoked','library_api_token',$2,'{}'::jsonb)`,
    [user!.id, id],
  ).catch(() => undefined);
  return NextResponse.json({ revoked: true, id }, { headers: { 'Cache-Control': 'no-store' } });
}
