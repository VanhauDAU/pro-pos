PRAGMA foreign_keys = ON;

ALTER TABLE service_tables ADD COLUMN qr_order_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (qr_order_enabled IN (0, 1));

ALTER TABLE store_settings ADD COLUMN qr_location_memory_minutes INTEGER NOT NULL DEFAULT 60
  CHECK (qr_location_memory_minutes BETWEEN 5 AND 480);
ALTER TABLE store_settings ADD COLUMN qr_order_cooldown_seconds INTEGER NOT NULL DEFAULT 3
  CHECK (qr_order_cooldown_seconds BETWEEN 1 AND 3600);
ALTER TABLE store_settings ADD COLUMN qr_call_staff_cooldown_seconds INTEGER NOT NULL DEFAULT 60
  CHECK (qr_call_staff_cooldown_seconds BETWEEN 1 AND 3600);
ALTER TABLE store_settings ADD COLUMN qr_checkout_cooldown_seconds INTEGER NOT NULL DEFAULT 60
  CHECK (qr_checkout_cooldown_seconds BETWEEN 1 AND 3600);
ALTER TABLE store_settings ADD COLUMN qr_sales_schedule_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (qr_sales_schedule_enabled IN (0, 1));
ALTER TABLE store_settings ADD COLUMN qr_sales_paused INTEGER NOT NULL DEFAULT 0
  CHECK (qr_sales_paused IN (0, 1));
ALTER TABLE store_settings ADD COLUMN qr_sales_paused_at INTEGER;

CREATE TABLE qr_order_sales_hours (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (end_minute > start_minute),
  UNIQUE (store_id, weekday, start_minute, end_minute)
);

CREATE INDEX idx_qr_order_sales_hours_store_weekday
  ON qr_order_sales_hours(store_id, weekday, start_minute);

CREATE TABLE qr_order_quick_reasons (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, label)
);

CREATE INDEX idx_qr_order_quick_reasons_store_status_order
  ON qr_order_quick_reasons(store_id, status, sort_order);

INSERT INTO qr_order_quick_reasons (
  id, store_id, label, status, sort_order, created_at, updated_at
)
SELECT store_id || ':qr-reason:1', store_id, 'Thêm chén/đũa/muỗng', 'ACTIVE', 0, updated_at, updated_at
FROM store_settings
UNION ALL
SELECT store_id || ':qr-reason:2', store_id, 'Thêm nước/đá', 'ACTIVE', 1, updated_at, updated_at
FROM store_settings
UNION ALL
SELECT store_id || ':qr-reason:3', store_id, 'Dọn bàn', 'ACTIVE', 2, updated_at, updated_at
FROM store_settings
UNION ALL
SELECT store_id || ':qr-reason:4', store_id, 'Hỗ trợ món ăn', 'ACTIVE', 3, updated_at, updated_at
FROM store_settings;

ALTER TABLE service_requests ADD COLUMN reason_id TEXT REFERENCES qr_order_quick_reasons(id);
ALTER TABLE service_requests ADD COLUMN reason_snapshot TEXT
  CHECK (reason_snapshot IS NULL OR length(reason_snapshot) <= 300);

DROP TRIGGER trg_create_guest_order_validate;

CREATE TRIGGER trg_create_guest_order_validate
BEFORE INSERT ON create_guest_order_request_commands
BEGIN
  SELECT RAISE(ABORT, 'TABLE_SESSION_NOT_ACTIVE') WHERE NOT EXISTS (
    SELECT 1 FROM guest_order_sessions gs
    JOIN time_sessions ts ON ts.id = gs.time_session_id AND ts.store_id = gs.store_id
    JOIN orders o ON o.id = ts.order_id AND o.store_id = ts.store_id
    JOIN service_tables st ON st.id = gs.table_id AND st.store_id = gs.store_id
    WHERE gs.id = NEW.guest_session_id AND gs.store_id = NEW.store_id
      AND gs.table_id = NEW.table_id AND gs.time_session_id = NEW.time_session_id
      AND ts.order_id = NEW.order_id AND gs.status = 'ACTIVE'
      AND gs.expires_at > NEW.issued_at AND ts.status IN ('RUNNING', 'PAUSED')
      AND o.status = 'OPEN' AND st.qr_order_enabled = 1
  );
  SELECT RAISE(ABORT, 'GUEST_ORDER_TOO_FAST') WHERE EXISTS (
    SELECT 1 FROM guest_order_requests gor
    JOIN store_settings ss ON ss.store_id = gor.store_id
    WHERE gor.guest_session_id = NEW.guest_session_id
      AND gor.created_at > NEW.issued_at - (ss.qr_order_cooldown_seconds * 1000)
  );
  SELECT RAISE(ABORT, 'GUEST_ORDER_RATE_LIMITED') WHERE (
    SELECT COUNT(*) FROM guest_order_requests
    WHERE guest_session_id = NEW.guest_session_id AND created_at > NEW.issued_at - 60000
  ) >= 5;
  SELECT RAISE(ABORT, 'TABLE_ORDER_RATE_LIMITED') WHERE (
    SELECT COUNT(*) FROM guest_order_requests
    WHERE store_id = NEW.store_id AND table_id = NEW.table_id
      AND created_at > NEW.issued_at - 300000
  ) >= 10;
  SELECT RAISE(ABORT, 'GUEST_IP_RATE_LIMITED') WHERE NEW.ip_hash IS NOT NULL AND (
    SELECT COUNT(*) FROM guest_order_requests gor
    JOIN guest_order_sessions gs ON gs.id = gor.guest_session_id
    WHERE gs.ip_hash = NEW.ip_hash AND gor.created_at > NEW.issued_at - 60000
  ) >= 60;
END;
