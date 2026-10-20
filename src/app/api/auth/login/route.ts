import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, isSameOrigin, startSession } from '@/lib/auth';

export const runtime = 'nodejs';
const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) });
const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const now = Date.now();
  const current = attempts.get(address);
  if (current && current.resetAt > now && current.count >= 10) return NextResponse.json({ error: 'Too many attempts. Wait 15 minutes and try again.' }, { status: 429 });
  if (!current || current.resetAt <= now) attempts.set(address, { count: 1, resetAt: now + 15 * 60_000 });
  else current.count += 1;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid email and password.' }, { status: 400 });
  try {
    const user = await authenticate(parsed.data.email, parsed.data.password);
    if (!user) return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });
    await startSession(user.id);
    attempts.delete(address);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to sign in.';
    return NextResponse.json({ error: message.includes('DATABASE_URL') || message.includes('connect') ? 'Studio database is unavailable. Start PostgreSQL and run the setup commands in README.md.' : 'Studio authentication is not configured. Check the server setup.' }, { status: 503 });
  }
}
