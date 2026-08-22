PRAGMA foreign_keys = OFF;

ALTER TABLE order_promotions RENAME TO order_promotions_single;

CREATE TABLE order_promotions (
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
  promotion_id TEXT NOT NULL REFERENCES promotions(id),
  applied_by TEXT REFERENCES users(id),
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, order_id, promotion_id)
);

INSERT INTO order_promotions (
  store_id, order_id, order_type, promotion_id, applied_by, applied_at
)
SELECT store_id, order_id, order_type, promotion_id, applied_by, applied_at
FROM order_promotions_single;

DROP TABLE order_promotions_single;

CREATE INDEX idx_order_promotions_program
  ON order_promotions(store_id, promotion_id);
CREATE INDEX idx_order_promotions_order
  ON order_promotions(store_id, order_id);

CREATE TABLE order_promotion_suppressions (
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  suppressed_by TEXT REFERENCES users(id),
  suppressed_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, order_id, promotion_id)
);

CREATE INDEX idx_order_promotion_suppressions_order
  ON order_promotion_suppressions(store_id, order_id);

PRAGMA foreign_keys = ON;
