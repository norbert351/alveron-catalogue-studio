CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS studio_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'editor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_expiry_idx ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('tops', 'bottoms', 'outerwear', 'shoes', 'accessories', 'sets', 'other')),
  color TEXT,
  fabric TEXT,
  pattern TEXT,
  fit TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES studio_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_created_idx ON products(created_at DESC, id);

CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 15728640),
  sha256 CHAR(64) NOT NULL,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  view_label TEXT NOT NULL DEFAULT 'Product view',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, product_id)
);
CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images(product_id, created_at, id);

CREATE TABLE IF NOT EXISTS product_image_reviews (
  product_image_id UUID PRIMARY KEY REFERENCES product_images(id) ON DELETE CASCADE,
  reviewed_by UUID NOT NULL REFERENCES studio_users(id),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalogues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  style TEXT NOT NULL,
  occasion TEXT NOT NULL,
  mixed_style_requested BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'review', 'approved', 'exported')),
  created_by UUID NOT NULL REFERENCES studio_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalogue_items (
  catalogue_id UUID NOT NULL REFERENCES catalogues(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_image_id UUID NOT NULL,
  outfit_role TEXT NOT NULL CHECK (outfit_role IN ('top', 'bottom', 'outerwear', 'shoes', 'accessory', 'set')),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (catalogue_id, product_id),
  FOREIGN KEY (product_image_id, product_id) REFERENCES product_images(id, product_id),
  UNIQUE (catalogue_id, position)
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogue_id UUID NOT NULL REFERENCES catalogues(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked', 'queued', 'running', 'failed', 'complete')),
  provider TEXT NOT NULL DEFAULT 'none',
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generated_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogue_id UUID NOT NULL REFERENCES catalogues(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  sha256 CHAR(64) NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, catalogue_id)
);

CREATE TABLE IF NOT EXISTS catalogue_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogue_id UUID NOT NULL REFERENCES catalogues(id) ON DELETE CASCADE,
  generated_asset_id UUID NOT NULL REFERENCES generated_assets(id),
  approved_by UUID NOT NULL REFERENCES studio_users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (catalogue_id, generated_asset_id),
  FOREIGN KEY (generated_asset_id, catalogue_id) REFERENCES generated_assets(id, catalogue_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES studio_users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
