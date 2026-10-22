import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './config';

/**
 * Short-lived, read-only links to a single original image.
 *
 * A browser click or an image fetcher cannot send `Authorization: Bearer`, so
 * the bearer-only original route is unreachable for them. Signed query params
 * solve exactly that: the signature binds product id + image id + expiry, so a
 * link can never be replayed against another image, another route, or after it
 * expires.
 *
 * This is additive. Bearer authentication still works and is still the method
 * for machine clients; a signature is only consulted when no Authorization
 * header is present.
 */

export const SIGNING_MAX_TTL_SECONDS = 60 * 60;
export const SIGNING_DEFAULT_TTL_SECONDS = 10 * 60;

export type SignatureVerdict = 'valid' | 'missing' | 'expired' | 'invalid';

function configuredSecret(): string | null {
  const secret = env.LIBRARY_SIGNING_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith('replace-')) return null;
  return secret;
}

export function isSigningConfigured(): boolean {
  return configuredSecret() !== null;
}

function payload(productId: string, imageId: string, exp: number): string {
  return `${productId}.${imageId}.${exp}`;
}

function sign(secret: string, productId: string, imageId: string, exp: number): string {
  return createHmac('sha256', secret).update(payload(productId, imageId, exp), 'utf8').digest('hex');
}

/** Build the signed query pair for one image, or null when signing is disabled. */
export function createSignedOriginalToken(
  productId: string,
  imageId: string,
  ttlSeconds: number = SIGNING_DEFAULT_TTL_SECONDS,
  secret: string | null = configuredSecret(),
): { exp: number; sig: string } | null {
  if (!secret) return null;
  const ttl = Math.min(Math.max(Math.trunc(ttlSeconds), 1), SIGNING_MAX_TTL_SECONDS);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return { exp, sig: sign(secret, productId, imageId, exp) };
}

/**
 * Verify a signature. Rejects: missing params, non-numeric or out-of-range
 * expiry (including links minted for longer than the maximum TTL), expired
 * links, and any tampering with the ids, expiry or signature.
 */
export function verifyOriginalSignature(
  input: { productId: string; imageId: string; exp?: string | null; sig?: string | null },
  secret: string | null = configuredSecret(),
): SignatureVerdict {
  const { productId, imageId } = input;
  const expRaw = input.exp ?? '';
  const sigRaw = input.sig ?? '';
  if (!expRaw && !sigRaw) return 'missing';
  if (!secret) return 'invalid';
  if (!/^\d{1,12}$/.test(expRaw)) return 'invalid';
  if (!/^[0-9a-f]{64}$/i.test(sigRaw)) return 'invalid';

  const exp = Number(expRaw);
  const now = Math.floor(Date.now() / 1000);
  if (exp <= now) return 'expired';
  // Guard against a leaked secret being used to mint decade-long links.
  if (exp > now + SIGNING_MAX_TTL_SECONDS + 60) return 'invalid';

  const expected = Buffer.from(sign(secret, productId, imageId, exp), 'utf8');
  const supplied = Buffer.from(sigRaw.toLowerCase(), 'utf8');
  if (expected.length !== supplied.length) return 'invalid';
  return timingSafeEqual(expected, supplied) ? 'valid' : 'invalid';
}

/** Absolute link for responses. Returns null when signing is not configured. */
export function signedOriginalUrl(
  origin: string,
  productId: string,
  imageId: string,
  ttlSeconds: number = SIGNING_DEFAULT_TTL_SECONDS,
  secret: string | null = configuredSecret(),
): string | null {
  const signed = createSignedOriginalToken(productId, imageId, ttlSeconds, secret);
  if (!signed) return null;
  const path = `/api/library/products/${productId}/images/${imageId}/original`;
  return `${origin}${path}?exp=${signed.exp}&sig=${signed.sig}`;
}
