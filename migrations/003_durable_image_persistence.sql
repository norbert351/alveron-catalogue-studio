-- Durable product-image persistence.
--
-- Goals (non-destructive and additive):
--   1. Originals stay exactly as uploaded and are never overwritten by a
--      derivative. This migration only *adds* structure around them.
--   2. Derivatives (thumbnails, normalised previews, edited/generated images)
--      live in their own table so an original can never be clobbered by a
--      compressed or resized copy.
--   3. An explicit, auditable retention policy exists instead of ad-hoc deletes.
--   4. Integrity checks can be recorded over time without rewriting origins.
--
-- No row in product_images is altered in a lossy way, and no object is deleted
-- by this migration.

-- ---------------------------------------------------------------------------
-- 1. Explicit product-level linkage for colour / design variants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  colour TEXT,
  design_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, product_id)
);
CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants(product_id, created_at);

-- Link images to a variant when one is known. Nullable: existing rows stay valid.
ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS variant_id UUID,
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verified_status TEXT
    CHECK (last_verified_status IS NULL OR last_verified_status IN ('intact', 'missing', 'checksum_mismatch', 'size_mismatch'));

ALTER TABLE product_images
  DROP CONSTRAINT IF EXISTS product_images_variant_fk;
ALTER TABLE product_images
  ADD CONSTRAINT product_images_variant_fk
  FOREIGN KEY (variant_id, product_id) REFERENCES product_variants(id, product_id);

-- ---------------------------------------------------------------------------
-- 2. Derivatives are a separate, clearly-typed concept
--    The original bytes referenced by product_images.object_key are immutable.
--    A derivative points *at* an original and carries its own storage key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_image_derivatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_image_id UUID NOT NULL REFERENCES product_images(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('thumbnail', 'preview', 'normalized', 'edited', 'catalogue')),
  object_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 CHAR(64) NOT NULL,
  storage_provider TEXT CHECK (storage_provider IN ('local', 's3')),
  -- Records exactly which original bytes produced this derivative.
  source_sha256 CHAR(64) NOT NULL,
  recipe JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_image_derivatives_source_idx ON product_image_derivatives(product_image_id, kind);

-- A derivative may never reuse an original's storage key, and an original may
-- never reuse a derivative's key. Enforced in one place so the two spaces stay
-- physically distinct no matter which code path writes next.
CREATE OR REPLACE FUNCTION assert_distinct_object_space() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'product_image_derivatives' THEN
    IF EXISTS (SELECT 1 FROM product_images WHERE object_key = NEW.object_key) THEN
      RAISE EXCEPTION 'Derivative key % collides with an immutable original', NEW.object_key;
    END IF;
  ELSIF TG_TABLE_NAME = 'product_images' THEN
    IF EXISTS (SELECT 1 FROM product_image_derivatives WHERE object_key = NEW.object_key) THEN
      RAISE EXCEPTION 'Original key % collides with an existing derivative', NEW.object_key;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_images_object_space_guard ON product_images;
CREATE TRIGGER product_images_object_space_guard
  BEFORE INSERT OR UPDATE OF object_key ON product_images
  FOR EACH ROW EXECUTE FUNCTION assert_distinct_object_space();

DROP TRIGGER IF EXISTS product_image_derivatives_object_space_guard ON product_image_derivatives;
CREATE TRIGGER product_image_derivatives_object_space_guard
  BEFORE INSERT OR UPDATE OF object_key ON product_image_derivatives
  FOR EACH ROW EXECUTE FUNCTION assert_distinct_object_space();

-- Originals are append-only. Bytes, checksums and dimensions are immutable once
-- written; only lifecycle/verification metadata may change. This makes "never
-- overwrite an original" a database guarantee rather than a convention.
CREATE OR REPLACE FUNCTION protect_original_image_identity() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.object_key IS DISTINCT FROM OLD.object_key
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.media_type IS DISTINCT FROM OLD.media_type
     OR NEW.width IS DISTINCT FROM OLD.width
     OR NEW.height IS DISTINCT FROM OLD.height
     OR NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'Original image identity is immutable (product, key, checksum, size, type and dimensions cannot change)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_images_identity_guard ON product_images;
CREATE TRIGGER product_images_identity_guard
  BEFORE UPDATE ON product_images
  FOR EACH ROW EXECUTE FUNCTION protect_original_image_identity();

-- ---------------------------------------------------------------------------
-- 3. Explicit retention policy + auditable deletion consent
--    Originals are retained by default. A physical delete needs a policy row and
--    a recorded, authorised decision -- never an incidental cascade.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS image_retention_policy (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  -- 'retain-all' keeps every original forever (default, safest).
  -- 'manual-review' allows a logged, authorised deletion request per image.
  mode TEXT NOT NULL DEFAULT 'retain-all' CHECK (mode IN ('retain-all', 'manual-review')),
  notes TEXT,
  updated_by UUID REFERENCES studio_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO image_retention_policy(id, mode, notes) VALUES (1, 'retain-all', 'Originals are retained indefinitely. Deletion requires an explicit authorised request.')
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS image_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_image_id UUID NOT NULL REFERENCES product_images(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES studio_users(id),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
  -- 'pending' -> authorised, bytes not yet removed. 'completed' -> bytes removed.
  -- 'rejected' -> request declined, nothing touched.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
  authorised_by UUID REFERENCES studio_users(id),
  decided_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- Snapshot of what was deleted, so the audit trail survives the object.
  object_key TEXT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  byte_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_deletion_requests_status_idx ON image_deletion_requests(status, created_at DESC);
-- At most one open request per image.
CREATE UNIQUE INDEX IF NOT EXISTS image_deletion_requests_open_idx
  ON image_deletion_requests(product_image_id) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 4. Integrity verification history (durability is evidenced, not assumed)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS image_integrity_checks (
  id BIGSERIAL PRIMARY KEY,
  product_image_id UUID NOT NULL REFERENCES product_images(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('intact', 'missing', 'checksum_mismatch', 'size_mismatch')),
  observed_sha256 CHAR(64),
  observed_byte_size BIGINT,
  storage_provider TEXT CHECK (storage_provider IN ('local', 's3')),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_integrity_checks_image_idx ON image_integrity_checks(product_image_id, checked_at DESC);
