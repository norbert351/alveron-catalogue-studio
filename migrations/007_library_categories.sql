-- Widen product categories to match how the owner actually describes stock.
--
-- The brief names: T-shirt, shirt, jeans, trousers, shorts, footwear, jacket,
-- accessory. The original column only allowed coarse buckets
-- (tops/bottoms/outerwear/shoes/accessories/sets/other), which forced a shirt and
-- a jacket into the same bucket and made filtering less useful for styling.
--
-- Additive and non-destructive:
--   * existing rows keep their current value (no data is rewritten);
--   * the old values stay valid, so nothing breaks if they are still in use;
--   * no column is dropped and no row is deleted.
--
-- The CHECK constraint is widened rather than replaced with free text, so a typo
-- still fails instead of silently creating a new category.

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_check;

ALTER TABLE products ADD CONSTRAINT products_category_check CHECK (category IN (
  -- original buckets, kept so existing records remain valid
  'tops', 'bottoms', 'outerwear', 'shoes', 'accessories', 'sets', 'other',
  -- specific garment types
  't-shirt', 'shirt', 'jeans', 'trousers', 'shorts', 'footwear', 'jacket', 'accessory',
  -- a few obvious neighbours so the list is usable without another migration
  'dress', 'skirt', 'bag', 'hat'
));

-- Filtering by category is a primary access path for both the owner and ChatGPT.
CREATE INDEX IF NOT EXISTS products_category_created_idx
  ON products(category, created_at DESC, id);
