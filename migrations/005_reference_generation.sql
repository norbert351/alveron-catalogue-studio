-- Reference-driven catalogue workflow.
--
-- Additive only. Originals in product_images are never touched, and no existing
-- generated asset is rewritten. Everything here records what a provider actually
-- produced and what was actually measured about it, so the review screen can show
-- evidence instead of an unverifiable claim of fidelity.

-- ---------------------------------------------------------------------------
-- 1. What the vision model saw in the real product photograph
-- ---------------------------------------------------------------------------
-- Kept on the image row so generation can preserve it and the UI can print a
-- product breakdown sourced from the photograph rather than invented by an LLM.
ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS vision_attributes JSONB,
  ADD COLUMN IF NOT EXISTS vision_extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vision_model TEXT,
  ADD COLUMN IF NOT EXISTS vision_error TEXT;

-- ---------------------------------------------------------------------------
-- 2. Provider provenance + measured fidelity on each generated asset
-- ---------------------------------------------------------------------------
ALTER TABLE generated_assets
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_model TEXT,
  ADD COLUMN IF NOT EXISTS provider_request_id TEXT,
  -- Machine-estimated comparison against the source photo. NULL means "not
  -- measured", which the UI renders as "unverified" rather than as success.
  ADD COLUMN IF NOT EXISTS fidelity JSONB,
  ADD COLUMN IF NOT EXISTS fidelity_ratio NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS fidelity_method TEXT,
  -- Assets are never overwritten; a regeneration creates a new row.
  ADD COLUMN IF NOT EXISTS supersedes_asset_id UUID REFERENCES generated_assets(id),
  ADD COLUMN IF NOT EXISTS source_sha256 CHAR(64);

CREATE INDEX IF NOT EXISTS generated_assets_fidelity_idx
  ON generated_assets(catalogue_id, fidelity_ratio DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- 3. Job -> provider link so a failure names the remote request
-- ---------------------------------------------------------------------------
ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS provider_request_id TEXT,
  ADD COLUMN IF NOT EXISTS completed_asset_id UUID REFERENCES generated_assets(id);

-- ---------------------------------------------------------------------------
-- 4. Explicit record of anything the model added that was not in the source
-- ---------------------------------------------------------------------------
-- The brief forbids presenting AI-invented accessories as real inventory. Storing
-- them means the UI can say so out loud on the asset itself.
CREATE TABLE IF NOT EXISTS generation_invented_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_asset_id UUID NOT NULL REFERENCES generated_assets(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generation_invented_items_asset_idx
  ON generation_invented_items(generated_asset_id);
