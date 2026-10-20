export type StudioRole = 'owner' | 'editor';
export type StudioIdentity = { id: string; role: StudioRole };

export function hasStudioAccess(user: StudioIdentity | null | undefined): user is StudioIdentity {
  return user?.role === 'owner' || user?.role === 'editor';
}

export function isSameOrigin(requestUrl: string, origin: string | null, host?: string | null, forwardedProtocol?: string | null): boolean {
  if (!origin) return false;
  try {
    const request = new URL(requestUrl);
    const hostname = host?.split(',')[0]?.trim();
    const protocol = forwardedProtocol?.split(',')[0]?.trim() || request.protocol.slice(0, -1);
    const expected = hostname ? new URL(`${protocol}://${hostname}`).origin : request.origin;
    return new URL(origin).origin === expected;
  }
  catch { return false; }
}

export function isSafeObjectKey(key: string): boolean {
  return /^[a-z0-9/_-]+\.(?:jpg|png|webp)$/.test(key) && !key.includes('..');
}
