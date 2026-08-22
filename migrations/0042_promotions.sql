PRAGMA foreign_keys = ON;

CREATE TABLE promotions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  promotion_type TEXT NOT NULL CHECK (promotion_type IN ('FIXED_AMOUNT', 'PERCENT', 'FLAT_PRICE', 'GIFT')),
  scope TEXT NOT NULL CHECK (scope IN ('INVOICE', 'CATEGORY', 'PRODUCT')),
  value INTEGER,
  minimum_order_vnd INTEGER NOT NULL DEFAULT 0 CHECK (minimum_order_vnd >= 0),
  maximum_discount_vnd INTEGER CHECK (maximum_discount_vnd > 0 OR maximum_discount_vnd IS NULL),
  auto_apply INTEGER NOT NULL DEFAULT 0 CHECK (auto_apply IN (0, 1)),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  weekdays_mask INTEGER CHECK (weekdays_mask BETWEEN 1 AND 127 OR weekdays_mask IS NULL),
  time_ranges_json TEXT NOT NULL DEFAULT '[]',
  maximum_gift_quantity INTEGER CHECK (maximum_gift_quantity > 0 OR maximum_gift_quantity IS NULL),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (promotion_type = 'GIFT' OR (value IS NOT NULL AND value > 0)),
  CHECK (promotion_type <> 'PERCENT' OR value <= 100),
  CHECK (promotion_type <> 'FLAT_PRICE' OR scope <> 'INVOICE'),
  CHECK (promotion_type <> 'GIFT' OR scope <> 'CATEGORY')
);

CREATE INDEX idx_promotions_store_status_time ON promotions(store_id, status, starts_at, ends_at);
CREATE INDEX idx_promotions_store_updated ON promotions(store_id, updated_at DESC);

CREATE TABLE promotion_targets (
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('CATEGORY', 'PRODUCT', 'GIFT_PRODUCT')),
  target_id TEXT NOT NULL,
  PRIMARY KEY (promotion_id, target_type, target_id)
);
CREATE INDEX idx_promotion_targets_lookup ON promotion_targets(store_id, target_type, target_id);

CREATE TABLE promotion_customer_groups (
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id),
  customer_group_id TEXT NOT NULL REFERENCES customer_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, customer_group_id)
);
CREATE INDEX idx_promotion_groups_lookup ON promotion_customer_groups(store_id, customer_group_id);

CREATE TABLE order_promotions (
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
  promotion_id TEXT NOT NULL REFERENCES promotions(id),
  applied_by TEXT REFERENCES users(id),
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, order_id)
);
CREATE INDEX idx_order_promotions_program ON order_promotions(store_id, promotion_id);

CREATE TABLE invoice_promotions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  invoice_id TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
  promotion_id TEXT NOT NULL REFERENCES promotions(id),
  promotion_name TEXT NOT NULL,
  promotion_type TEXT NOT NULL,
  discount_amount_vnd INTEGER NOT NULL CHECK (discount_amount_vnd >= 0),
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (store_id, invoice_id, promotion_id)
);
