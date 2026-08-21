PRAGMA foreign_keys = ON;

CREATE TABLE table_qr_codes (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  token_hash TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  rotated_at INTEGER NOT NULL,
  UNIQUE (store_id, table_id)
);

CREATE TABLE guest_order_sessions (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES stores(id),
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  time_session_id TEXT NOT NULL REFERENCES time_sessions(id),
  qr_code_id TEXT NOT NULL REFERENCES table_qr_codes(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  ip_hash TEXT,
  device_nonce TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_guest_sessions_time_status
  ON guest_order_sessions(store_id, time_session_id, status);

CREATE TABLE guest_order_requests (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  guest_session_id TEXT NOT NULL REFERENCES guest_order_sessions(id),
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  time_session_id TEXT NOT NULL REFERENCES time_sessions(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED')
  ),
  client_request_id TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT REFERENCES users(id),
  rejected_reason TEXT,
  UNIQUE (guest_session_id, client_request_id)
);

CREATE INDEX idx_guest_orders_store_status_created
  ON guest_order_requests(store_id, status, created_at);
CREATE INDEX idx_guest_orders_session_created
  ON guest_order_requests(guest_session_id, created_at);

CREATE TABLE guest_order_request_items (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  request_id TEXT NOT NULL REFERENCES guest_order_requests(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT REFERENCES product_variants(id),
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT,
  unit_name_snapshot TEXT,
  unit_price_snapshot INTEGER NOT NULL CHECK (unit_price_snapshot >= 0),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  gross_line_total INTEGER NOT NULL CHECK (gross_line_total >= 0),
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_guest_order_items_request ON guest_order_request_items(request_id);

CREATE TABLE create_guest_order_request_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  guest_session_id TEXT NOT NULL REFERENCES guest_order_sessions(id),
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  time_session_id TEXT NOT NULL REFERENCES time_sessions(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  request_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  note TEXT,
  ip_hash TEXT,
  issued_at INTEGER NOT NULL,
  UNIQUE (guest_session_id, client_request_id)
);

CREATE TRIGGER trg_create_guest_order_validate
BEFORE INSERT ON create_guest_order_request_commands
BEGIN
  SELECT RAISE(ABORT, 'TABLE_SESSION_NOT_ACTIVE') WHERE NOT EXISTS (
    SELECT 1 FROM guest_order_sessions gs
    JOIN time_sessions ts ON ts.id = gs.time_session_id AND ts.store_id = gs.store_id
    JOIN orders o ON o.id = ts.order_id AND o.store_id = ts.store_id
    WHERE gs.id = NEW.guest_session_id AND gs.store_id = NEW.store_id
      AND gs.table_id = NEW.table_id AND gs.time_session_id = NEW.time_session_id
      AND ts.order_id = NEW.order_id AND gs.status = 'ACTIVE'
      AND gs.expires_at > NEW.issued_at AND ts.status IN ('RUNNING', 'PAUSED')
      AND o.status = 'OPEN'
  );
  SELECT RAISE(ABORT, 'GUEST_ORDER_TOO_FAST') WHERE EXISTS (
    SELECT 1 FROM guest_order_requests
    WHERE guest_session_id = NEW.guest_session_id AND created_at > NEW.issued_at - 3000
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

CREATE TRIGGER trg_create_guest_order_execute
AFTER INSERT ON create_guest_order_request_commands
BEGIN
  INSERT INTO guest_order_requests (
    id, store_id, guest_session_id, table_id, time_session_id, order_id,
    status, client_request_id, note, created_at
  ) VALUES (
    NEW.request_id, NEW.store_id, NEW.guest_session_id, NEW.table_id,
    NEW.time_session_id, NEW.order_id, 'PENDING', NEW.client_request_id,
    NEW.note, NEW.issued_at
  );
  INSERT INTO audit_logs (
    id, store_id, action, entity_type, entity_id, request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'GUEST_ORDER_CREATED',
    'GUEST_ORDER_REQUEST', NEW.request_id, NEW.client_request_id,
    json_object('orderId', NEW.order_id, 'tableId', NEW.table_id), NEW.issued_at
  );
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    (SELECT version FROM orders WHERE id = NEW.order_id), NULL, NULL,
    NEW.client_request_id, NEW.client_request_id,
    json_array('guest.orders'),
    json_object('reason', 'GUEST_ORDER_CREATED', 'guestRequestId', NEW.request_id,
      'affectedTableIds', json_array(NEW.table_id)), NEW.issued_at
  );
END;

CREATE TABLE accept_guest_order_request_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  guest_request_id TEXT NOT NULL REFERENCES guest_order_requests(id),
  expected_order_version INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  actor_session_id TEXT REFERENCES auth_sessions(id),
  device_id TEXT REFERENCES devices(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_accept_guest_order_validate
BEFORE INSERT ON accept_guest_order_request_commands
BEGIN
  SELECT RAISE(ABORT, 'GUEST_ORDER_NOT_ACCEPTABLE') WHERE NOT EXISTS (
    SELECT 1 FROM guest_order_requests gor
    JOIN guest_order_sessions gs ON gs.id = gor.guest_session_id
    JOIN time_sessions ts ON ts.id = gor.time_session_id
    JOIN orders o ON o.id = gor.order_id
    WHERE gor.id = NEW.guest_request_id AND gor.store_id = NEW.store_id
      AND gor.status = 'PENDING' AND gs.status = 'ACTIVE'
      AND gs.expires_at > NEW.issued_at AND ts.status IN ('RUNNING', 'PAUSED')
      AND o.status = 'OPEN' AND o.version = NEW.expected_order_version
  );
END;

CREATE TRIGGER trg_accept_guest_order_execute
AFTER INSERT ON accept_guest_order_request_commands
BEGIN
  INSERT INTO order_items (
    id, store_id, order_id, product_id, variant_id, product_type,
    product_name_snapshot, variant_name_snapshot, unit_name_snapshot,
    unit_price_snapshot, quantity_milli, discount_type, discount_value,
    line_total, discount_input_value, discount_amount, gross_line_total,
    net_line_total, added_by, created_at, updated_at, note,
    time_started_at, time_ended_at
  )
  SELECT
    lower(hex(randomblob(16))), gri.store_id, gor.order_id, gri.product_id,
    gri.variant_id, 'QUANTITY', gri.product_name_snapshot,
    gri.variant_name_snapshot, gri.unit_name_snapshot, gri.unit_price_snapshot,
    gri.quantity_milli, NULL, 0, gri.gross_line_total, NULL, 0,
    gri.gross_line_total, gri.gross_line_total, NEW.actor_user_id,
    NEW.issued_at, NEW.issued_at, gri.note, NULL, NULL
  FROM guest_order_request_items gri
  JOIN guest_order_requests gor ON gor.id = gri.request_id
  WHERE gri.request_id = NEW.guest_request_id;

  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE id = (SELECT order_id FROM guest_order_requests WHERE id = NEW.guest_request_id)
    AND store_id = NEW.store_id AND version = NEW.expected_order_version;

  UPDATE guest_order_requests
  SET status = 'ACCEPTED', decided_at = NEW.issued_at, decided_by = NEW.actor_user_id
  WHERE id = NEW.guest_request_id AND store_id = NEW.store_id AND status = 'PENDING';

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, actor_session_id, device_id,
    action, entity_type, entity_id, request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    NEW.actor_session_id, NEW.device_id, 'GUEST_ORDER_ACCEPTED',
    'GUEST_ORDER_REQUEST', NEW.guest_request_id, NEW.request_id,
    json_object('orderId', (SELECT order_id FROM guest_order_requests WHERE id = NEW.guest_request_id)),
    NEW.issued_at
  );

  INSERT INTO realtime_event_requests
  SELECT lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', gor.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NEW.device_id, NEW.id, NEW.request_id,
    json_array('guest.orders', 'pos.orders', 'pos.order:' || gor.order_id),
    json_object('reason', 'GUEST_ORDER_ACCEPTED', 'guestRequestId', gor.id,
      'affectedTableIds', json_array(gor.table_id)), NEW.issued_at
  FROM guest_order_requests gor WHERE gor.id = NEW.guest_request_id;
END;

CREATE TABLE reject_guest_order_request_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  guest_request_id TEXT NOT NULL REFERENCES guest_order_requests(id),
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  actor_session_id TEXT REFERENCES auth_sessions(id),
  device_id TEXT REFERENCES devices(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_reject_guest_order_validate
BEFORE INSERT ON reject_guest_order_request_commands
BEGIN
  SELECT RAISE(ABORT, 'GUEST_ORDER_ALREADY_DECIDED') WHERE NOT EXISTS (
    SELECT 1 FROM guest_order_requests
    WHERE id = NEW.guest_request_id AND store_id = NEW.store_id AND status = 'PENDING'
  );
END;

CREATE TRIGGER trg_reject_guest_order_execute
AFTER INSERT ON reject_guest_order_request_commands
BEGIN
  UPDATE guest_order_requests
  SET status = 'REJECTED', decided_at = NEW.issued_at, decided_by = NEW.actor_user_id,
      rejected_reason = NEW.reason
  WHERE id = NEW.guest_request_id AND store_id = NEW.store_id;
  INSERT INTO audit_logs (
    id, store_id, actor_user_id, actor_session_id, device_id, action,
    entity_type, entity_id, request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    NEW.actor_session_id, NEW.device_id, 'GUEST_ORDER_REJECTED',
    'GUEST_ORDER_REQUEST', NEW.guest_request_id, NEW.request_id,
    json_object('reason', NEW.reason), NEW.issued_at
  );
  INSERT INTO realtime_event_requests
  SELECT lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', gor.order_id,
    (SELECT version FROM orders WHERE id = gor.order_id), NEW.actor_user_id,
    NEW.device_id, NEW.id, NEW.request_id, json_array('guest.orders'),
    json_object('reason', 'GUEST_ORDER_REJECTED', 'guestRequestId', gor.id,
      'affectedTableIds', json_array(gor.table_id)), NEW.issued_at
  FROM guest_order_requests gor WHERE gor.id = NEW.guest_request_id;
END;

CREATE TABLE service_requests (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  time_session_id TEXT NOT NULL REFERENCES time_sessions(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  guest_session_id TEXT NOT NULL REFERENCES guest_order_sessions(id),
  type TEXT NOT NULL CHECK (type IN ('CALL_STAFF', 'CHECKOUT_REQUEST')),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED')),
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  acknowledged_by TEXT REFERENCES users(id),
  completed_at INTEGER
);

CREATE UNIQUE INDEX uq_open_service_request
  ON service_requests(time_session_id, type) WHERE status IN ('OPEN', 'ACKNOWLEDGED');
CREATE INDEX idx_service_requests_store_status
  ON service_requests(store_id, status, created_at);

-- Closing or moving the table invalidates all guest authority from the old session/table.
CREATE TRIGGER trg_qr_revoke_on_stop_time
AFTER INSERT ON stop_time_commands
BEGIN
  UPDATE guest_order_sessions SET status = 'REVOKED'
  WHERE store_id = NEW.store_id AND time_session_id IN (
    SELECT id FROM time_sessions WHERE order_id = NEW.order_id
  ) AND status = 'ACTIVE';
  UPDATE guest_order_requests SET status = 'EXPIRED'
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id AND status = 'PENDING';
  UPDATE service_requests SET status = 'CANCELLED'
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    AND status IN ('OPEN', 'ACKNOWLEDGED');
END;

CREATE TRIGGER trg_qr_revoke_on_transfer
AFTER INSERT ON transfer_table_commands
BEGIN
  UPDATE guest_order_sessions SET status = 'REVOKED'
  WHERE store_id = NEW.store_id AND time_session_id IN (
    SELECT id FROM time_sessions WHERE order_id = NEW.order_id
  ) AND status = 'ACTIVE';
  UPDATE guest_order_requests SET status = 'EXPIRED'
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id AND status = 'PENDING';
END;

CREATE TRIGGER trg_qr_revoke_on_checkout
AFTER INSERT ON checkout_commands
BEGIN
  UPDATE guest_order_sessions SET status = 'REVOKED'
  WHERE store_id = NEW.store_id AND time_session_id IN (
    SELECT id FROM time_sessions WHERE order_id = NEW.order_id
  ) AND status = 'ACTIVE';
END;

CREATE TRIGGER trg_qr_revoke_on_cancel
AFTER INSERT ON cancel_order_commands
BEGIN
  UPDATE guest_order_sessions SET status = 'REVOKED'
  WHERE store_id = NEW.store_id AND time_session_id IN (
    SELECT id FROM time_sessions WHERE order_id = NEW.order_id
  ) AND status = 'ACTIVE';
END;
