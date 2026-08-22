PRAGMA foreign_keys = ON;

ALTER TABLE order_items ADD COLUMN discount_reason TEXT;
ALTER TABLE takeaway_order_items ADD COLUMN discount_reason TEXT;

CREATE INDEX idx_order_items_discount_reason
  ON order_items(store_id, order_id, discount_reason)
  WHERE discount_reason IS NOT NULL;

CREATE INDEX idx_takeaway_order_items_discount_reason
  ON takeaway_order_items(store_id, order_id, discount_reason)
  WHERE discount_reason IS NOT NULL;
