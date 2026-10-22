-- ChatGPT retrieval tokens.
--
-- Additive only. Nothing is dropped and no existing row is modified, so this is
-- safe to apply to a database that already holds product records and originals.
--
-- Why a separate table rather than reusing `sessions`:
--   * a browser session is a cookie tied to a human sitting at the app;
--   * a retrieval token is a bearer credential carried by an external system
--     (ChatGPT), must be revocable on its own, is read-only, and should be
--     auditable per use.
-- Sharing one mechanism would mean revoking ChatGPT also logs the owner out,
-- and would let a leaked token mutate the library.
--
-- Only a SHA-256 digest of the token is stored. The plaintext token is shown
-- once at creation and never persisted, so a database dump does not leak a
-- working credential.

CREATE TABLE IF NOT EXISTS library_api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  -- sha256(token) hex. A token is 32 random bytes, so a plain hash is enough:
  -- there is no low-entropy secret to brute force.
  token_hash CHAR(64) NOT NULL UNIQUE,
  -- Read-only by construction: this build has exactly one scope. Stored
  -- explicitly so a future write scope cannot be granted by accident.
  scope TEXT NOT NULL DEFAULT 'library:read' CHECK (scope IN ('library:read')),
  created_by UUID REFERENCES studio_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  use_count BIGINT NOT NULL DEFAULT 0,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS library_api_tokens_active_idx
  ON library_api_tokens(token_hash)
  WHERE revoked_at IS NULL;
