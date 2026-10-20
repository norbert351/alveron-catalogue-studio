import { NextResponse } from 'next/server';
import { endSession, isSameOrigin } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  await endSession();
  return NextResponse.json({ ok: true });
}
