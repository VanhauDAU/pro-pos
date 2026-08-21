PRAGMA foreign_keys = ON;

-- Add guest_count, customer_name, customer_phone to orders and takeaway_orders
ALTER TABLE orders ADD COLUMN guest_count INTEGER NOT NULL DEFAULT 1 CHECK (guest_count >= 1);
ALTER TABLE takeaway_orders ADD COLUMN guest_count INTEGER NOT NULL DEFAULT 1 CHECK (guest_count >= 1);
ALTER TABLE orders ADD COLUMN customer_name TEXT;
ALTER TABLE orders ADD COLUMN customer_phone TEXT;
ALTER TABLE takeaway_orders ADD COLUMN customer_name TEXT;
ALTER TABLE takeaway_orders ADD COLUMN customer_phone TEXT;

-- Command table to update guest count and customer info
CREATE TABLE update_order_guest_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
  order_id TEXT NOT NULL,
  expected_order_version INTEGER NOT NULL,
  guest_count INTEGER NOT NULL CHECK (guest_count >= 1),
  customer_name TEXT,
  customer_phone TEXT,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_update_order_guest_validate
BEFORE INSERT ON update_order_guest_commands
BEGIN
  SELECT (CASE WHEN NEW.order_type = 'DINE_IN' AND NOT EXISTS (
    SELECT 1 FROM orders WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status IN ('OPEN', 'PAYMENT_PENDING') AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
  SELECT (CASE WHEN NEW.order_type = 'TAKEAWAY' AND NOT EXISTS (
    SELECT 1 FROM takeaway_orders WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status IN ('OPEN', 'PAYMENT_PENDING') AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
END;

CREATE TRIGGER trg_update_order_guest_execute
AFTER INSERT ON update_order_guest_commands
BEGIN
  UPDATE orders
  SET guest_count = NEW.guest_count,
      customer_name = NEW.customer_name,
      customer_phone = NEW.customer_phone,
      version = version + 1,
      updated_at = NEW.issued_at
  WHERE NEW.order_type = 'DINE_IN' AND id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE takeaway_orders
  SET guest_count = NEW.guest_count,
      customer_name = NEW.customer_name,
      customer_phone = NEW.customer_phone,
      version = version + 1,
      updated_at = NEW.issued_at
  WHERE NEW.order_type = 'TAKEAWAY' AND id = NEW.order_id AND store_id = NEW.store_id;
END;
