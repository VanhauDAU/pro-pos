-- ============================================================
-- MIGRATION 0016: CHECKOUT PENDING & STOP TIME LIFECYCLE
-- ============================================================

-- 1. Table & triggers for stopping time when entering checkout
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
  -- 1. Close active table_time_segments (guarantee ended_at >= started_at)
  UPDATE table_time_segments
  SET ended_at = MAX(started_at, NEW.issued_at), updated_at = MAX(started_at, NEW.issued_at)
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id AND ended_at IS NULL;

  -- 2. Update time_sessions status to ENDED (guarantee ended_at >= started_at)
  UPDATE time_sessions
  SET status = 'ENDED', ended_at = MAX(started_at, NEW.issued_at), updated_at = MAX(started_at, NEW.issued_at)
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  -- 3. Update orders status to PAYMENT_PENDING
  UPDATE orders
  SET status = 'PAYMENT_PENDING', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  -- 4. Record audit log
  INSERT INTO audit_logs (
    id, store_id, actor_user_id, device_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id, NEW.device_id,
    'ORDER_CHECKOUT_PENDING', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'stoppedAt', NEW.issued_at),
    NEW.issued_at
  );
END;

-- 2. Table & triggers for resuming playing from PAYMENT_PENDING
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
  -- 1. Create a brand new table_time_segments starting at NEW.issued_at (ended_at = NULL)
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

  -- 2. Resume time_sessions: status = 'RUNNING', ended_at = NULL
  UPDATE time_sessions
  SET status = 'RUNNING', ended_at = NULL, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  -- 3. Set orders status back to OPEN
  UPDATE orders
  SET status = 'OPEN', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  -- 4. Record audit log
  INSERT INTO audit_logs (
    id, store_id, actor_user_id, device_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id, NEW.device_id,
    'ORDER_RESUMED_FROM_CHECKOUT', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'resumedAt', NEW.issued_at),
    NEW.issued_at
  );
END;

-- 3. Update trg_checkout_validate to allow status IN ('OPEN', 'PAYMENT_PENDING')
DROP TRIGGER IF EXISTS trg_checkout_validate;
CREATE TRIGGER trg_checkout_validate
BEFORE INSERT ON checkout_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id
      AND store_id = NEW.store_id
      AND table_id = NEW.table_id
      AND status IN ('OPEN', 'PAYMENT_PENDING')
      AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);

  SELECT (CASE WHEN EXISTS (
    SELECT 1 FROM payments
    WHERE order_id = NEW.order_id AND status = 'SUCCEEDED'
  ) THEN RAISE(ABORT, 'ORDER_ALREADY_PAID') END);

  SELECT (CASE WHEN NEW.method = 'CASH' AND (
    NEW.cash_received IS NULL OR NEW.cash_received < NEW.total
  ) THEN RAISE(ABORT, 'INSUFFICIENT_CASH') END);
END;

-- 4. Update trg_takeaway_checkout_validate to allow status IN ('OPEN', 'PAYMENT_PENDING')
DROP TRIGGER IF EXISTS trg_takeaway_checkout_validate;
CREATE TRIGGER trg_takeaway_checkout_validate
BEFORE INSERT ON takeaway_checkout_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM takeaway_orders WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status IN ('OPEN', 'PAYMENT_PENDING') AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
  SELECT (CASE WHEN EXISTS (
    SELECT 1 FROM takeaway_payments WHERE order_id = NEW.order_id AND status = 'SUCCEEDED'
  ) THEN RAISE(ABORT, 'ORDER_ALREADY_PAID') END);
END;
