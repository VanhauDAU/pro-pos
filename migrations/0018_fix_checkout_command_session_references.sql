-- Repair databases where migration 0016 was applied before auth_sessions
-- replaced the former user_sessions table name.

PRAGMA defer_foreign_keys = ON;

DROP TRIGGER IF EXISTS trg_stop_time_validate;
DROP TRIGGER IF EXISTS trg_stop_time_execute;
DROP TRIGGER IF EXISTS trg_resume_checkout_validate;
DROP TRIGGER IF EXISTS trg_resume_checkout_execute;

ALTER TABLE stop_time_commands RENAME TO stop_time_commands_legacy;
ALTER TABLE resume_checkout_commands RENAME TO resume_checkout_commands_legacy;

CREATE TABLE stop_time_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  expected_order_version INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  actor_session_id TEXT REFERENCES auth_sessions(id),
  device_id TEXT REFERENCES devices(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TABLE resume_checkout_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  expected_order_version INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  actor_session_id TEXT REFERENCES auth_sessions(id),
  device_id TEXT REFERENCES devices(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

-- Old command rows are retained. Their session IDs are kept only when they
-- match the current auth_sessions table; obsolete values become NULL.
INSERT INTO stop_time_commands (
  id, store_id, order_id, expected_order_version, actor_user_id,
  actor_session_id, device_id, request_id, issued_at
)
SELECT
  id, store_id, order_id, expected_order_version, actor_user_id,
  CASE WHEN EXISTS (SELECT 1 FROM auth_sessions WHERE id = actor_session_id)
    THEN actor_session_id ELSE NULL END,
  device_id, request_id, issued_at
FROM stop_time_commands_legacy;

INSERT INTO resume_checkout_commands (
  id, store_id, order_id, expected_order_version, actor_user_id,
  actor_session_id, device_id, request_id, issued_at
)
SELECT
  id, store_id, order_id, expected_order_version, actor_user_id,
  CASE WHEN EXISTS (SELECT 1 FROM auth_sessions WHERE id = actor_session_id)
    THEN actor_session_id ELSE NULL END,
  device_id, request_id, issued_at
FROM resume_checkout_commands_legacy;

DROP TABLE stop_time_commands_legacy;
DROP TABLE resume_checkout_commands_legacy;

CREATE TRIGGER trg_stop_time_validate
BEFORE INSERT ON stop_time_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'OPEN' AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
END;

CREATE TRIGGER trg_stop_time_execute
AFTER INSERT ON stop_time_commands
BEGIN
  UPDATE table_time_segments
  SET ended_at = MAX(started_at, NEW.issued_at), updated_at = MAX(started_at, NEW.issued_at)
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id AND ended_at IS NULL;

  UPDATE time_sessions
  SET status = 'ENDED', ended_at = MAX(started_at, NEW.issued_at), updated_at = MAX(started_at, NEW.issued_at)
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  UPDATE orders
  SET status = 'PAYMENT_PENDING', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, device_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id, NEW.device_id,
    'ORDER_CHECKOUT_PENDING', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'stoppedAt', NEW.issued_at), NEW.issued_at
  );
END;

CREATE TRIGGER trg_resume_checkout_validate
BEFORE INSERT ON resume_checkout_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'PAYMENT_PENDING' AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_NOT_PAYMENT_PENDING') END);
END;

CREATE TRIGGER trg_resume_checkout_execute
AFTER INSERT ON resume_checkout_commands
BEGIN
  INSERT INTO table_time_segments (
    id, store_id, order_id, time_session_id, table_id, time_product_id,
    table_name_snapshot, started_at, ended_at, pricing_snapshot_json,
    pricing_version, unit_price_snapshot, created_at, updated_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, NEW.order_id, ts.id,
    ts.table_id, ts.time_product_id, COALESCE(st.display_name, st.name),
    NEW.issued_at, NULL, ts.pricing_snapshot_json, ts.pricing_version,
    COALESCE(json_extract(ts.pricing_snapshot_json, '$.basePriceVnd'), 0),
    NEW.issued_at, NEW.issued_at
  FROM time_sessions ts
  JOIN service_tables st ON st.id = ts.table_id AND st.store_id = NEW.store_id
  WHERE ts.order_id = NEW.order_id AND ts.store_id = NEW.store_id;

  UPDATE time_sessions
  SET status = 'RUNNING', ended_at = NULL, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  UPDATE orders
  SET status = 'OPEN', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, device_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id, NEW.device_id,
    'ORDER_RESUMED_FROM_CHECKOUT', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'resumedAt', NEW.issued_at), NEW.issued_at
  );
END;
