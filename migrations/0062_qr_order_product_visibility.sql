PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN qr_order_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (qr_order_enabled IN (0, 1));
