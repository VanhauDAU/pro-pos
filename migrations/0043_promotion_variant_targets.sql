PRAGMA foreign_keys = OFF;

ALTER TABLE promotions
  ADD COLUMN gift_buy_any INTEGER NOT NULL DEFAULT 0 CHECK (gift_buy_any IN (0, 1));

ALTER TABLE promotion_targets RENAME TO promotion_targets_legacy;

CREATE TABLE promotion_targets (
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('CATEGORY', 'PRODUCT', 'GIFT_PRODUCT')),
  target_id TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT '',
  required_quantity INTEGER NOT NULL DEFAULT 1 CHECK (required_quantity > 0),
  PRIMARY KEY (promotion_id, target_type, target_id, variant_id)
);

INSERT INTO promotion_targets (
  promotion_id, store_id, target_type, target_id, variant_id, required_quantity
)
SELECT promotion_id, store_id, target_type, target_id, '', 1
FROM promotion_targets_legacy;

DROP TABLE promotion_targets_legacy;

CREATE INDEX idx_promotion_targets_lookup
  ON promotion_targets(store_id, target_type, target_id);

PRAGMA foreign_keys = ON;
