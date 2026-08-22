PRAGMA foreign_keys = ON;

ALTER TABLE orders
  ADD COLUMN promotion_auto_apply_suppressed INTEGER NOT NULL DEFAULT 0
  CHECK (promotion_auto_apply_suppressed IN (0, 1));

ALTER TABLE takeaway_orders
  ADD COLUMN promotion_auto_apply_suppressed INTEGER NOT NULL DEFAULT 0
  CHECK (promotion_auto_apply_suppressed IN (0, 1));
