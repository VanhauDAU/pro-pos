PRAGMA foreign_keys = ON;

-- Store-scoped rollout switches. Absence means disabled.
CREATE TABLE store_capabilities (
  store_id TEXT NOT NULL REFERENCES stores(id),
  capability TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, capability)
);

CREATE TABLE realtime_store_sequences (
  store_id TEXT PRIMARY KEY REFERENCES stores(id),
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0)
);

CREATE TABLE realtime_events (
  event_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('pos.order.created', 'pos.order.changed', 'pos.order.closed')
  ),
  aggregate_type TEXT NOT NULL CHECK (aggregate_type = 'ORDER'),
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version > 0),
  actor_kind TEXT CHECK (actor_kind IN ('OWNER', 'EMPLOYEE') OR actor_kind IS NULL),
  actor_user_id TEXT REFERENCES users(id),
  device_id TEXT REFERENCES devices(id),
  client_mutation_id TEXT,
  request_id TEXT NOT NULL,
  topics_json TEXT NOT NULL CHECK (json_valid(topics_json)),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  occurred_at INTEGER NOT NULL,
  published_at INTEGER,
  publish_attempts INTEGER NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_publish_error TEXT,
  UNIQUE (store_id, sequence)
);

CREATE INDEX idx_realtime_events_store_sequence
  ON realtime_events(store_id, sequence);
CREATE INDEX idx_realtime_events_pending
  ON realtime_events(published_at, occurred_at)
  WHERE published_at IS NULL;
CREATE INDEX idx_realtime_events_published
  ON realtime_events(published_at)
  WHERE published_at IS NOT NULL;

-- Ephemeral staging table used by command triggers. The row is inserted and removed
-- in the same command transaction; its AFTER INSERT trigger allocates the store
-- sequence and persists the outbox event.
CREATE TABLE realtime_event_requests (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_version INTEGER NOT NULL,
  actor_user_id TEXT,
  device_id TEXT,
  client_mutation_id TEXT,
  request_id TEXT NOT NULL,
  topics_json TEXT NOT NULL,
  data_json TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);

CREATE TRIGGER trg_realtime_event_request_execute
AFTER INSERT ON realtime_event_requests
BEGIN
  INSERT INTO realtime_store_sequences (store_id, last_sequence)
  SELECT NEW.store_id, 1
  WHERE EXISTS (
    SELECT 1 FROM store_capabilities
    WHERE store_id = NEW.store_id AND capability = 'POS_REALTIME' AND enabled = 1
  )
  ON CONFLICT(store_id) DO UPDATE SET last_sequence = last_sequence + 1;

  INSERT INTO realtime_events (
    event_id, store_id, sequence, schema_version, event_type,
    aggregate_type, aggregate_id, aggregate_version,
    actor_kind, actor_user_id, device_id, client_mutation_id, request_id,
    topics_json, data_json, occurred_at
  )
  SELECT
    NEW.id, NEW.store_id, seq.last_sequence, 1, NEW.event_type,
    'ORDER', NEW.order_id, NEW.order_version,
    CASE
      WHEN NEW.actor_user_id IS NULL THEN NULL
      WHEN EXISTS (SELECT 1 FROM pin_verifiers WHERE user_id = NEW.actor_user_id)
        THEN 'EMPLOYEE'
      ELSE 'OWNER'
    END,
    NEW.actor_user_id, NEW.device_id, NEW.client_mutation_id, NEW.request_id,
    NEW.topics_json, NEW.data_json, NEW.occurred_at
  FROM realtime_store_sequences seq
  WHERE seq.store_id = NEW.store_id
    AND EXISTS (
      SELECT 1 FROM store_capabilities
      WHERE store_id = NEW.store_id AND capability = 'POS_REALTIME' AND enabled = 1
    );

  DELETE FROM realtime_event_requests WHERE id = NEW.id;
END;

-- P0: make time-session deletion a version-guarded, idempotent command.
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

CREATE TRIGGER trg_remove_time_session_validate
BEFORE INSERT ON remove_time_session_commands
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'OPEN' AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM time_sessions
    WHERE id = NEW.time_session_id AND order_id = NEW.order_id AND store_id = NEW.store_id
  ) THEN RAISE(ABORT, 'TIME_SESSION_NOT_FOUND') END;
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

-- P0: creating a missing time session during range adjustment is also a command.
CREATE TABLE create_time_session_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  time_session_id TEXT NOT NULL,
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  time_product_id TEXT NOT NULL REFERENCES products(id),
  table_name_snapshot TEXT NOT NULL,
  expected_order_version INTEGER NOT NULL,
  pricing_snapshot_json TEXT NOT NULL,
  pricing_version INTEGER NOT NULL,
  unit_price_snapshot INTEGER NOT NULL CHECK (unit_price_snapshot >= 0),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  session_status TEXT NOT NULL CHECK (session_status IN ('RUNNING', 'ENDED', 'PAUSED')),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  actor_session_id TEXT REFERENCES auth_sessions(id),
  device_id TEXT REFERENCES devices(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id),
  CHECK (started_at <= issued_at),
  CHECK (ended_at IS NULL OR (ended_at > started_at AND ended_at <= issued_at))
);

CREATE TRIGGER trg_create_time_session_validate
BEFORE INSERT ON create_time_session_commands
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND order_type = 'DINE_IN' AND status = 'OPEN'
      AND table_id = NEW.table_id AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM time_sessions WHERE order_id = NEW.order_id
  ) THEN RAISE(ABORT, 'TIME_SESSION_ALREADY_EXISTS') END;
END;

CREATE TRIGGER trg_create_time_session_execute
AFTER INSERT ON create_time_session_commands
BEGIN
  INSERT INTO time_sessions (
    id, store_id, order_id, table_id, time_product_id, status,
    started_at, ended_at, pricing_snapshot_json, pricing_version, opened_by, updated_at
  ) VALUES (
    NEW.time_session_id, NEW.store_id, NEW.order_id, NEW.table_id, NEW.time_product_id,
    NEW.session_status, NEW.started_at, NEW.ended_at, NEW.pricing_snapshot_json,
    NEW.pricing_version, NEW.actor_user_id, NEW.issued_at
  );
  INSERT INTO table_time_segments (
    id, store_id, order_id, time_session_id, table_id, time_product_id,
    table_name_snapshot, started_at, ended_at, pricing_snapshot_json,
    pricing_version, unit_price_snapshot, created_at, updated_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.order_id, NEW.time_session_id,
    NEW.table_id, NEW.time_product_id, NEW.table_name_snapshot, NEW.started_at,
    NEW.ended_at, NEW.pricing_snapshot_json, NEW.pricing_version,
    NEW.unit_price_snapshot, NEW.issued_at, NEW.issued_at
  );
  UPDATE orders
  SET version = version + 1, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND id = NEW.order_id
    AND version = NEW.expected_order_version;
  INSERT INTO audit_logs (
    id, store_id, actor_user_id, actor_session_id, device_id,
    action, entity_type, entity_id, request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    NEW.actor_session_id, NEW.device_id, 'TIME_RANGE_CREATED', 'ORDER', NEW.order_id,
    NEW.request_id,
    json_object('startedAtMs', NEW.started_at, 'endedAtMs', NEW.ended_at), NEW.issued_at
  );
END;

-- Command-to-event adapters. These run inside the original command INSERT.
CREATE TRIGGER trg_rt_create_takeaway AFTER INSERT ON create_takeaway_order_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.created', NEW.order_id, 1,
    NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'CREATED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_open_table AFTER INSERT ON open_table_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.created', NEW.order_id, 1,
    NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'CREATED', 'affectedTableIds', json_array(NEW.table_id)), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_add_item AFTER INSERT ON add_item_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'ITEM_ADDED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_add_takeaway_item AFTER INSERT ON add_takeaway_item_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'ITEM_ADDED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_update_item AFTER INSERT ON update_order_item_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'ITEM_UPDATED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_remove_item AFTER INSERT ON remove_order_item_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'ITEM_REMOVED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_update_note AFTER INSERT ON update_order_note_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'NOTE_UPDATED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_update_guest AFTER INSERT ON update_order_guest_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'GUEST_UPDATED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_pause AFTER INSERT ON pause_time_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NEW.device_id, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'TIME_PAUSED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_resume AFTER INSERT ON resume_time_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NEW.device_id, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'TIME_RESUMED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_update_time AFTER INSERT ON update_time_range_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NEW.device_id, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'TIME_RANGE_UPDATED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_create_time AFTER INSERT ON create_time_session_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NEW.device_id, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'TIME_RANGE_UPDATED', 'affectedTableIds', json_array(NEW.table_id)),
    NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_remove_time AFTER INSERT ON remove_time_session_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NEW.device_id, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'TIME_REMOVED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_stop_time AFTER INSERT ON stop_time_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NEW.device_id, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'TIME_STOPPED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_resume_checkout AFTER INSERT ON resume_checkout_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NEW.device_id, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'CHECKOUT_RESUMED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_checkout AFTER INSERT ON checkout_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.closed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'CHECKOUT_COMPLETED', 'affectedTableIds', json_array(NEW.table_id)),
    NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_takeaway_checkout AFTER INSERT ON takeaway_checkout_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.closed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'CHECKOUT_COMPLETED'), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_transfer AFTER INSERT ON transfer_table_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'TABLE_TRANSFERRED', 'affectedTableIds',
      json_array(NEW.source_table_id, NEW.target_table_id)), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_cancel AFTER INSERT ON cancel_order_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.closed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'CANCELLED', 'affectedTableIds', json_array(NEW.table_id)), NEW.issued_at
  );
END;

CREATE TRIGGER trg_rt_cancel_takeaway AFTER INSERT ON cancel_takeaway_order_commands BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.closed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'CANCELLED'), NEW.issued_at
  );
END;
