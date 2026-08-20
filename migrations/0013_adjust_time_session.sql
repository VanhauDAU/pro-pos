-- Audited, idempotent command for correcting a dine-in session's billable range.
CREATE TABLE update_time_range_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  expected_order_version INTEGER NOT NULL,
  previous_started_at INTEGER NOT NULL,
  previous_ended_at INTEGER,
  previous_status TEXT NOT NULL CHECK (previous_status IN ('RUNNING', 'PAUSED', 'ENDED')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  actor_session_id TEXT REFERENCES auth_sessions(id),
  device_id TEXT REFERENCES devices(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  CHECK (started_at <= issued_at),
  CHECK (ended_at IS NULL OR (ended_at > started_at AND ended_at <= issued_at)),
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_update_time_range_validate
BEFORE INSERT ON update_time_range_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN time_sessions ts ON ts.order_id = o.id AND ts.store_id = o.store_id
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND o.status = 'OPEN' AND o.version = NEW.expected_order_version
      AND ts.started_at = NEW.previous_started_at
      AND ts.ended_at IS NEW.previous_ended_at
      AND ts.status = NEW.previous_status
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
END;

CREATE TRIGGER trg_update_time_range_execute
AFTER INSERT ON update_time_range_commands
BEGIN
  UPDATE time_sessions
  SET started_at = NEW.started_at,
      ended_at = NEW.ended_at,
      status = CASE
        WHEN NEW.ended_at IS NOT NULL THEN 'ENDED'
        WHEN EXISTS (
          SELECT 1 FROM time_pauses tp
          WHERE tp.time_session_id = time_sessions.id AND tp.resumed_at IS NULL
        ) THEN 'PAUSED'
        ELSE 'RUNNING'
      END,
      updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  UPDATE orders
  SET version = version + 1, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND id = NEW.order_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, actor_session_id, device_id, action,
    entity_type, entity_id, request_id, before_json, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    NEW.actor_session_id, NEW.device_id, 'TIME_RANGE_UPDATED', 'ORDER', NEW.order_id,
    NEW.request_id,
    json_object(
      'startedAtMs', NEW.previous_started_at,
      'endedAtMs', NEW.previous_ended_at,
      'status', NEW.previous_status,
      'orderVersion', NEW.expected_order_version
    ),
    json_object(
      'startedAtMs', NEW.started_at,
      'endedAtMs', NEW.ended_at,
      'status', CASE WHEN NEW.ended_at IS NULL THEN 'ACTIVE' ELSE 'ENDED' END,
      'orderVersion', NEW.expected_order_version + 1
    ),
    NEW.issued_at
  );
END;
