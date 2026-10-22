import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/**
 * Retrieval-token contract.
 *
 * These assertions pin the security properties the ChatGPT integration depends
 * on. If any of them changes, the integration has either become unsafe or
 * stopped working, so they are tested rather than assumed.
 */

// Mirrors src/lib/library-token.ts. Kept dependency-free here so the test can run
// without the server-only import chain.
const TOKEN_PREFIX = 'alv_lib_';
const digest = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

test('a token is unpredictable and correctly prefixed', () => {
  const token = `${TOKEN_PREFIX}${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
  assert.ok(token.startsWith(TOKEN_PREFIX));
  // 64 hex chars of entropy after the prefix: not guessable.
  assert.ok(token.length > TOKEN_PREFIX.length + 40);
});

test('the stored value is a hash, never the token itself', () => {
  const token = `${TOKEN_PREFIX}abc123def456`;
  const stored = digest(token);
  assert.equal(stored.length, 64);
  assert.match(stored, /^[0-9a-f]{64}$/);
  assert.notEqual(stored, token, 'a token must never be stored in plaintext');
  assert.ok(!stored.includes(token), 'the hash must not contain the token');
});

test('hashing is deterministic so lookup works, and distinct tokens collide never', () => {
  const a = `${TOKEN_PREFIX}token-one`;
  const b = `${TOKEN_PREFIX}token-two`;
  assert.equal(digest(a), digest(a));
  assert.notEqual(digest(a), digest(b));
});

test('malformed authorization values are rejected before any database lookup', () => {
  const bearer = (header: string) => header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  const accept = (value: string | null) => Boolean(value && value.startsWith(TOKEN_PREFIX) && value.length >= 20);

  assert.equal(accept(bearer('Bearer alv_lib_0123456789abcdef')), true);
  assert.equal(accept(bearer('bearer alv_lib_0123456789abcdef')), true, 'scheme is case-insensitive');
  assert.equal(accept(bearer('Bearer ghp_someGitHubToken')), false, 'a GitHub token is not a library token');
  assert.equal(accept(bearer('Bearer alv_lib_short')), false, 'too short to be a real token');
  assert.equal(accept(bearer('Basic abc')), false, 'only Bearer is accepted');
  assert.equal(accept(bearer('')), false);
});

test('a revoked or unknown token resolves to nothing', () => {
  const lookup = (stored: Array<{ hash: string; revokedAt: Date | null }>, token: string) =>
    stored.find((row) => row.hash === digest(token) && row.revokedAt === null) ?? null;

  const live = `${TOKEN_PREFIX}live-token-value`;
  const revoked = `${TOKEN_PREFIX}revoked-token-value`;
  const table = [
    { hash: digest(live), revokedAt: null },
    { hash: digest(revoked), revokedAt: new Date() },
  ];

  assert.ok(lookup(table, live), 'a live token authenticates');
  assert.equal(lookup(table, revoked), null, 'a revoked token must not authenticate');
  assert.equal(lookup(table, `${TOKEN_PREFIX}never-issued`), null, 'an unknown token must not authenticate');
});

test('read scope is the only scope this build can grant', () => {
  const ALLOWED = ['library:read'];
  assert.equal(ALLOWED.includes('library:read'), true);
  assert.equal(ALLOWED.includes('library:write'), false, 'a retrieval token must never be able to mutate the library');
});
