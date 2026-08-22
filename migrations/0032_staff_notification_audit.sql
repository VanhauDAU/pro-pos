PRAGMA foreign_keys = ON;

-- Short-lived operational history for employee-facing QR notifications.
-- This is intentionally separate from audit_logs: financial/security audit is
-- retained by its own policy, while these compact notification snapshots expire.
CREATE TABLE staff_notification_events (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('GUEST_ORDER', 'SERVICE_REQUEST')),
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('QR_ORDER', 'CALL_STAFF', 'CHECKOUT_REQUEST')),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'OPEN', 'ACKNOWLEDGED', 'ACCEPTED', 'REJECTED',
    'COMPLETED', 'CANCELLED', 'EXPIRED'
  )),
  order_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  table_name_snapshot TEXT NOT NULL,
  area_name_snapshot TEXT NOT NULL,
  summary TEXT NOT NULL CHECK (length(summary) <= 800),
  note TEXT CHECK (note IS NULL OR length(note) <= 300),
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  total_vnd INTEGER NOT NULL DEFAULT 0 CHECK (total_vnd >= 0),
  actor_user_id TEXT,
  actor_session_id TEXT,
  device_id TEXT,
  handled_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (store_id, source_type, source_id)
);

CREATE INDEX idx_staff_notification_store_created
  ON staff_notification_events(store_id, created_at DESC);
CREATE INDEX idx_staff_notification_expires
  ON staff_notification_events(expires_at);

CREATE TRIGGER trg_staff_notification_expire_on_stop
AFTER INSERT ON stop_time_commands
BEGIN
  UPDATE staff_notification_events
  SET status = CASE WHEN source_type = 'GUEST_ORDER' THEN 'EXPIRED' ELSE 'CANCELLED' END,
      handled_at = COALESCE(handled_at, NEW.issued_at)
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    AND status IN ('PENDING', 'OPEN', 'ACKNOWLEDGED');
END;

CREATE TRIGGER trg_staff_notification_expire_on_transfer
AFTER INSERT ON transfer_table_commands
BEGIN
  UPDATE staff_notification_events
  SET status = CASE WHEN source_type = 'GUEST_ORDER' THEN 'EXPIRED' ELSE 'CANCELLED' END,
      handled_at = COALESCE(handled_at, NEW.issued_at)
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    AND status IN ('PENDING', 'OPEN', 'ACKNOWLEDGED');
END;

CREATE TRIGGER trg_staff_notification_expire_on_cancel
AFTER INSERT ON cancel_order_commands
BEGIN
  UPDATE staff_notification_events
  SET status = 'CANCELLED', handled_at = COALESCE(handled_at, NEW.issued_at)
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    AND status IN ('PENDING', 'OPEN', 'ACKNOWLEDGED');
END;
