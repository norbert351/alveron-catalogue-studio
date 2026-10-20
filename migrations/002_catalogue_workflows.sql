-- Additive workflow and recovery fields. Original product rows and image objects are retained.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS availability TEXT NOT NULL DEFAULT 'active' CHECK (availability IN ('active', 'unavailable', 'archived')),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS owner_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verified_attributes JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS products_availability_idx ON products(availability, created_at DESC, id);
CREATE INDEX IF NOT EXISTS products_tags_idx ON products USING GIN(tags);

CREATE TABLE IF NOT EXISTS studio_inventory_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO studio_inventory_state(id,revision) VALUES(1,1) ON CONFLICT(id) DO NOTHING;

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS colour_design_label TEXT,
  ADD COLUMN IF NOT EXISTS supersedes_image_id UUID REFERENCES product_images(id),
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS storage_provider TEXT CHECK (storage_provider IN ('local', 's3'));
CREATE INDEX IF NOT EXISTS product_images_current_idx ON product_images(product_id, is_current, created_at, id);

-- A request can be retried without creating duplicate products. Failed uploads remain inspectable.
CREATE TABLE IF NOT EXISTS product_upload_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES studio_users(id),
  idempotency_key TEXT NOT NULL,
  request_sha256 CHAR(64),
  product_id UUID,
  status TEXT NOT NULL CHECK (status IN ('receiving', 'complete', 'failed')),
  object_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, idempotency_key),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS product_upload_requests_status_idx ON product_upload_requests(status, updated_at);

CREATE TABLE IF NOT EXISTS storage_recovery_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key TEXT NOT NULL,
  storage_provider TEXT NOT NULL CHECK (storage_provider IN ('local','s3')),
  purpose TEXT NOT NULL,
  entity_id UUID,
  expected_sha256 CHAR(64) NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(storage_provider,object_key)
);
CREATE INDEX IF NOT EXISTS storage_recovery_created_idx ON storage_recovery_objects(created_at);

ALTER TABLE catalogues
  ADD COLUMN IF NOT EXISTS source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT 'editorial',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE catalogues DROP CONSTRAINT IF EXISTS catalogues_status_check;
ALTER TABLE catalogues ADD CONSTRAINT catalogues_status_check CHECK (status IN ('draft', 'queued', 'running', 'review', 'approved', 'rejected', 'exported', 'failed'));

ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_idempotency_idx ON generation_jobs(catalogue_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS generation_jobs_claim_idx ON generation_jobs(status, available_at, created_at);

ALTER TABLE generated_assets
  ADD COLUMN IF NOT EXISTS generation_job_id UUID REFERENCES generation_jobs(id),
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image/png',
  ADD COLUMN IF NOT EXISTS byte_size BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS output_kind TEXT NOT NULL DEFAULT 'generated' CHECK (output_kind IN ('generated', 'original-photo-composition')),
  ADD COLUMN IF NOT EXISTS input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES studio_users(id);
ALTER TABLE generated_assets
  ADD COLUMN IF NOT EXISTS storage_provider TEXT CHECK (storage_provider IN ('local', 's3'));
CREATE INDEX IF NOT EXISTS generated_assets_catalogue_created_idx ON generated_assets(catalogue_id, created_at DESC);
ALTER TABLE catalogue_approvals
  ADD COLUMN IF NOT EXISTS approved_revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS output_sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidation_reason TEXT;
ALTER TABLE catalogue_approvals DROP CONSTRAINT IF EXISTS catalogue_approvals_catalogue_id_generated_asset_id_key;
CREATE INDEX IF NOT EXISTS catalogue_approvals_latest_idx ON catalogue_approvals(catalogue_id, generated_asset_id, approved_at DESC);

CREATE TABLE IF NOT EXISTS catalogue_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogue_id UUID NOT NULL REFERENCES catalogues(id),
  generated_asset_id UUID NOT NULL REFERENCES generated_assets(id),
  rejected_by UUID NOT NULL REFERENCES studio_users(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (generated_asset_id, catalogue_id) REFERENCES generated_assets(id, catalogue_id)
);
CREATE INDEX IF NOT EXISTS catalogue_rejections_catalogue_idx ON catalogue_rejections(catalogue_id, created_at DESC);

CREATE TABLE IF NOT EXISTS catalogue_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogue_id UUID NOT NULL REFERENCES catalogues(id),
  generated_asset_id UUID NOT NULL REFERENCES generated_assets(id),
  approval_id UUID NOT NULL REFERENCES catalogue_approvals(id),
  exported_by UUID NOT NULL REFERENCES studio_users(id),
  format TEXT NOT NULL CHECK (format IN ('png', 'jpeg', 'pdf')),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  object_key TEXT NOT NULL UNIQUE,
  sha256 CHAR(64) NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (generated_asset_id, catalogue_id) REFERENCES generated_assets(id, catalogue_id)
);
CREATE INDEX IF NOT EXISTS catalogue_exports_catalogue_idx ON catalogue_exports(catalogue_id, created_at DESC);
ALTER TABLE catalogue_exports ADD COLUMN IF NOT EXISTS storage_provider TEXT CHECK (storage_provider IN ('local','s3'));

CREATE TABLE IF NOT EXISTS generation_job_attempts (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'failed', 'complete')),
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE(job_id, attempt)
);
