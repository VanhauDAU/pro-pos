PRAGMA foreign_keys = ON;

ALTER TABLE qr_order_quick_reasons ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0, 1));

ALTER TABLE product_variants ADD COLUMN qr_order_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (qr_order_enabled IN (0, 1));

-- Product-level visibility was introduced in 0062. Visibility now lives on each
-- sellable variant, so normalize every existing product to its new default.
UPDATE products SET qr_order_enabled = 1;
