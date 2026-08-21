PRAGMA foreign_keys = OFF;

-- A deletion command must retain its idempotency record after the referenced
-- time session is removed, so time_session_id intentionally is not a foreign key.
DROP TRIGGER IF EXISTS trg_rt_remove_time;
DROP TRIGGER IF EXISTS trg_remove_time_session_execute;
DROP TRIGGER IF EXISTS trg_remove_time_session_validate;

ALTER TABLE remove_time_session_commands RENAME TO remove_time_session_commands_old;

CREATE TABLE remove_time_session_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  time_session_id TEXT NOT NULL,
  expected_order_version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  actor_session_id TEXT REFERENCES auth_sessions(id),
  device_id TEXT REFERENCES devices(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

INSERT INTO remove_time_session_commands (
  id, store_id, order_id, time_session_id, expected_order_version, reason,
  actor_user_id, actor_session_id, device_id, request_id, issued_at
)
SELECT
  id, store_id, order_id, time_session_id, expected_order_version, reason,
  actor_user_id, actor_session_id, device_id, request_id, issued_at
FROM remove_time_session_commands_old;

DROP TABLE remove_time_session_commands_old;

CREATE TRIGGER trg_remove_time_session_validate
BEFORE INSERT ON remove_time_session_commands
BEGIN
  SELECT RAISE(ABORT, 'ORDER_VERSION_CONFLICT') WHERE NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'OPEN' AND version = NEW.expected_order_version
  );
  SELECT RAISE(ABORT, 'TIME_SESSION_NOT_FOUND') WHERE NOT EXISTS (
    SELECT 1 FROM time_sessions
    WHERE id = NEW.time_session_id AND order_id = NEW.order_id AND store_id = NEW.store_id
  );
END;

CREATE TRIGGER trg_remove_time_session_execute
AFTER INSERT ON remove_time_session_commands
BEGIN
  DELETE FROM time_pauses
  WHERE store_id = NEW.store_id AND time_session_id = NEW.time_session_id;
  DELETE FROM table_time_segments
  WHERE store_id = NEW.store_id AND time_session_id = NEW.time_session_id;
  DELETE FROM time_sessions
  WHERE store_id = NEW.store_id AND id = NEW.time_session_id AND order_id = NEW.order_id;
  UPDATE orders
  SET version = version + 1, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND id = NEW.order_id
    AND version = NEW.expected_order_version;
  INSERT INTO audit_logs (
    id, store_id, actor_user_id, actor_session_id, device_id,
    action, entity_type, entity_id, request_id, before_json, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    NEW.actor_session_id, NEW.device_id, 'TIME_SESSION_REMOVED', 'TIME_SESSION',
    NEW.time_session_id, NEW.request_id,
    json_object('sessionId', NEW.time_session_id, 'orderId', NEW.order_id),
    json_object('reason', NEW.reason), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_remove_time
AFTER INSERT ON remove_time_session_commands
BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NEW.device_id, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'TIME_REMOVED'), NEW.issued_at
  );
END;

PRAGMA foreign_keys = ON;
