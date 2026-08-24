PRAGMA foreign_keys = ON;

CREATE TABLE payment_snapshots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
  order_version INTEGER NOT NULL,
  command_id TEXT NOT NULL,
  quote_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'CONSUMED', 'INVALIDATED')),
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  invalidated_at INTEGER,
  UNIQUE (store_id, command_id)
);

CREATE UNIQUE INDEX uq_payment_snapshots_active_order
  ON payment_snapshots(store_id, order_id)
  WHERE status = 'ACTIVE';

CREATE INDEX idx_payment_snapshots_store_order_created
  ON payment_snapshots(store_id, order_id, created_at DESC);

ALTER TABLE checkout_commands ADD COLUMN payment_snapshot_id TEXT;
ALTER TABLE takeaway_checkout_commands ADD COLUMN payment_snapshot_id TEXT;

CREATE TRIGGER trg_checkout_payment_snapshot_validate
BEFORE INSERT ON checkout_commands
WHEN NEW.payment_snapshot_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_SNAPSHOT_INVALID') WHERE NOT EXISTS (
    SELECT 1 FROM payment_snapshots ps
    WHERE ps.id = NEW.payment_snapshot_id
      AND ps.store_id = NEW.store_id
      AND ps.order_id = NEW.order_id
      AND ps.order_type = 'DINE_IN'
      AND ps.order_version = NEW.expected_order_version
      AND ps.status = 'ACTIVE'
  );
END;

CREATE TRIGGER trg_takeaway_checkout_payment_snapshot_validate
BEFORE INSERT ON takeaway_checkout_commands
WHEN NEW.payment_snapshot_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_SNAPSHOT_INVALID') WHERE NOT EXISTS (
    SELECT 1 FROM payment_snapshots ps
    WHERE ps.id = NEW.payment_snapshot_id
      AND ps.store_id = NEW.store_id
      AND ps.order_id = NEW.order_id
      AND ps.order_type = 'TAKEAWAY'
      AND ps.order_version = NEW.expected_order_version
      AND ps.status = 'ACTIVE'
  );
END;
