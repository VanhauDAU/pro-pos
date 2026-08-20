PRAGMA foreign_keys = ON;

CREATE TABLE service_tables (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  area_id TEXT NOT NULL REFERENCES areas(id),
  time_product_id TEXT NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'DISABLED')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, area_id, name COLLATE NOCASE)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'PAYMENT_PENDING', 'PAID', 'CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1,
  opened_by TEXT NOT NULL REFERENCES users(id),
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  cancelled_at INTEGER,
  cancel_reason TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_active_order_per_table
  ON orders(store_id, table_id)
  WHERE status IN ('OPEN', 'PAYMENT_PENDING');

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT REFERENCES product_variants(id),
  product_type TEXT NOT NULL CHECK (product_type IN ('QUANTITY', 'WEIGHT', 'TIME')),
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT,
  unit_name_snapshot TEXT,
  unit_price_snapshot INTEGER NOT NULL CHECK (unit_price_snapshot >= 0),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  discount_type TEXT CHECK (discount_type IN ('FIXED', 'PERCENT') OR discount_type IS NULL),
  discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  added_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE time_sessions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  time_product_id TEXT NOT NULL REFERENCES products(id),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'PAUSED', 'ENDED')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  paused_seconds INTEGER NOT NULL DEFAULT 0 CHECK (paused_seconds >= 0),
  pricing_snapshot_json TEXT NOT NULL,
  pricing_version INTEGER NOT NULL,
  opened_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  UNIQUE (order_id)
);

CREATE TABLE time_pauses (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  time_session_id TEXT NOT NULL REFERENCES time_sessions(id),
  paused_at INTEGER NOT NULL,
  resumed_at INTEGER,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_active_pause_per_session
  ON time_pauses(time_session_id)
  WHERE resumed_at IS NULL;

CREATE TABLE pricing_segments (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  time_session_id TEXT NOT NULL REFERENCES time_sessions(id),
  segment_type TEXT NOT NULL CHECK (segment_type IN ('FIRST_PERIOD', 'SPECIAL', 'BASE')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  elapsed_seconds INTEGER NOT NULL CHECK (elapsed_seconds >= 0),
  price INTEGER NOT NULL CHECK (price >= 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  amount_before_rounding INTEGER NOT NULL CHECK (amount_before_rounding >= 0),
  created_at INTEGER NOT NULL
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL CHECK (method IN ('CASH', 'BANK_TRANSFER')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'VOIDED')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  cash_received INTEGER CHECK (cash_received >= 0),
  cash_change INTEGER CHECK (cash_change >= 0),
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  voided_at INTEGER,
  UNIQUE (store_id, idempotency_key)
);

CREATE UNIQUE INDEX uq_succeeded_payment_per_order
  ON payments(order_id)
  WHERE status = 'SUCCEEDED';

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  display_code TEXT NOT NULL,
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  discount_total INTEGER NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'CANCELLED')),
  issued_at INTEGER NOT NULL,
  issued_by TEXT NOT NULL REFERENCES users(id),
  snapshot_json TEXT NOT NULL,
  UNIQUE (store_id, display_code)
);

CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  line_type TEXT NOT NULL CHECK (line_type IN ('PRODUCT', 'TIME')),
  description TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  snapshot_json TEXT NOT NULL
);

CREATE INDEX idx_tables_store_status ON service_tables(store_id, status);
CREATE INDEX idx_orders_store_status_created ON orders(store_id, status, created_at);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_time_sessions_store_status ON time_sessions(store_id, status);
CREATE INDEX idx_payments_order_status ON payments(order_id, status);
CREATE INDEX idx_invoices_store_issued ON invoices(store_id, issued_at);

CREATE TABLE open_table_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  expected_table_version INTEGER NOT NULL,
  order_id TEXT NOT NULL,
  time_session_id TEXT NOT NULL,
  pricing_snapshot_json TEXT NOT NULL,
  pricing_version INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_open_table_validate
BEFORE INSERT ON open_table_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM service_tables
    WHERE id = NEW.table_id
      AND store_id = NEW.store_id
      AND status = 'AVAILABLE'
      AND version = NEW.expected_table_version
  ) THEN RAISE(ABORT, 'TABLE_NOT_AVAILABLE') END);
END;

CREATE TRIGGER trg_open_table_execute
AFTER INSERT ON open_table_commands
BEGIN
  INSERT INTO orders (
    id, store_id, table_id, status, version, opened_by, opened_at, created_at, updated_at
  ) VALUES (
    NEW.order_id, NEW.store_id, NEW.table_id, 'OPEN', 1,
    NEW.actor_user_id, NEW.issued_at, NEW.issued_at, NEW.issued_at
  );

  INSERT INTO time_sessions (
    id, store_id, order_id, table_id, time_product_id, status, started_at,
    pricing_snapshot_json, pricing_version, opened_by, updated_at
  )
  SELECT
    NEW.time_session_id, NEW.store_id, NEW.order_id, st.id, st.time_product_id,
    'RUNNING', NEW.issued_at, NEW.pricing_snapshot_json, NEW.pricing_version,
    NEW.actor_user_id, NEW.issued_at
  FROM service_tables st WHERE st.id = NEW.table_id AND st.store_id = NEW.store_id;

  UPDATE service_tables
  SET status = 'OCCUPIED', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.table_id AND store_id = NEW.store_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, device_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id, NULL,
    'TABLE_OPENED', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('tableId', NEW.table_id, 'orderId', NEW.order_id), NEW.issued_at
  );
END;

CREATE TABLE add_item_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  expected_order_version INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT REFERENCES product_variants(id),
  product_type TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT,
  unit_name_snapshot TEXT,
  unit_price_snapshot INTEGER NOT NULL,
  quantity_milli INTEGER NOT NULL,
  discount_type TEXT,
  discount_value INTEGER NOT NULL,
  line_total INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_add_item_validate
BEFORE INSERT ON add_item_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id
      AND store_id = NEW.store_id
      AND status = 'OPEN'
      AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
END;

CREATE TRIGGER trg_add_item_execute
AFTER INSERT ON add_item_commands
BEGIN
  INSERT INTO order_items (
    id, store_id, order_id, product_id, variant_id, product_type,
    product_name_snapshot, variant_name_snapshot, unit_name_snapshot,
    unit_price_snapshot, quantity_milli, discount_type, discount_value,
    line_total, added_by, created_at, updated_at
  ) VALUES (
    NEW.item_id, NEW.store_id, NEW.order_id, NEW.product_id, NEW.variant_id,
    NEW.product_type, NEW.product_name_snapshot, NEW.variant_name_snapshot,
    NEW.unit_name_snapshot, NEW.unit_price_snapshot, NEW.quantity_milli,
    NEW.discount_type, NEW.discount_value, NEW.line_total,
    NEW.actor_user_id, NEW.issued_at, NEW.issued_at
  );

  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;
END;

CREATE TABLE checkout_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  expected_order_version INTEGER NOT NULL,
  payment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  invoice_display_code TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('CASH', 'BANK_TRANSFER')),
  subtotal INTEGER NOT NULL,
  discount_total INTEGER NOT NULL,
  total INTEGER NOT NULL,
  cash_received INTEGER,
  cash_change INTEGER,
  time_line_description TEXT NOT NULL,
  time_elapsed_seconds INTEGER NOT NULL,
  time_amount INTEGER NOT NULL,
  time_snapshot_json TEXT NOT NULL,
  invoice_snapshot_json TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_checkout_validate
BEFORE INSERT ON checkout_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id
      AND store_id = NEW.store_id
      AND table_id = NEW.table_id
      AND status = 'OPEN'
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

CREATE TRIGGER trg_checkout_execute
AFTER INSERT ON checkout_commands
BEGIN
  INSERT INTO payments (
    id, store_id, order_id, method, status, amount, cash_received,
    cash_change, idempotency_key, created_by, created_at
  ) VALUES (
    NEW.payment_id, NEW.store_id, NEW.order_id, NEW.method, 'SUCCEEDED',
    NEW.total, NEW.cash_received, NEW.cash_change, NEW.id,
    NEW.actor_user_id, NEW.issued_at
  );

  INSERT INTO invoices (
    id, store_id, order_id, display_code, subtotal, discount_total,
    total, status, issued_at, issued_by, snapshot_json
  ) VALUES (
    NEW.invoice_id, NEW.store_id, NEW.order_id, NEW.invoice_display_code,
    NEW.subtotal, NEW.discount_total, NEW.total, 'COMPLETED',
    NEW.issued_at, NEW.actor_user_id, NEW.invoice_snapshot_json
  );

  INSERT INTO invoice_lines (
    id, store_id, invoice_id, line_type, description, quantity_milli,
    unit_price, discount_amount, line_total, snapshot_json
  )
  SELECT
    lower(hex(randomblob(16))), oi.store_id, NEW.invoice_id, 'PRODUCT',
    oi.product_name_snapshot, oi.quantity_milli, oi.unit_price_snapshot,
    CASE WHEN oi.discount_type IS NULL THEN 0 ELSE oi.discount_value END,
    oi.line_total,
    json_object(
      'productId', oi.product_id,
      'variantId', oi.variant_id,
      'productName', oi.product_name_snapshot,
      'variantName', oi.variant_name_snapshot,
      'unitName', oi.unit_name_snapshot
    )
  FROM order_items oi
  WHERE oi.order_id = NEW.order_id AND oi.store_id = NEW.store_id;

  INSERT INTO invoice_lines (
    id, store_id, invoice_id, line_type, description, quantity_milli,
    unit_price, discount_amount, line_total, snapshot_json
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, NEW.invoice_id, 'TIME',
    NEW.time_line_description, NEW.time_elapsed_seconds * 1000,
    NEW.time_amount, 0, NEW.time_amount, NEW.time_snapshot_json
  WHERE NEW.time_elapsed_seconds > 0 OR NEW.time_amount > 0;

  UPDATE orders
  SET status = 'PAID', version = version + 1, closed_at = NEW.issued_at,
      updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE time_sessions
  SET status = 'ENDED', ended_at = NEW.issued_at, updated_at = NEW.issued_at
  WHERE order_id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE service_tables
  SET status = 'AVAILABLE', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.table_id AND store_id = NEW.store_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'CHECKOUT_COMPLETED', 'INVOICE', NEW.invoice_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'total', NEW.total, 'method', NEW.method),
    NEW.issued_at
  );
END;

CREATE TABLE transfer_table_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  source_table_id TEXT NOT NULL REFERENCES service_tables(id),
  target_table_id TEXT NOT NULL REFERENCES service_tables(id),
  expected_order_version INTEGER NOT NULL,
  expected_source_version INTEGER NOT NULL,
  expected_target_version INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_transfer_table_validate
BEFORE INSERT ON transfer_table_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN service_tables source ON source.id = o.table_id AND source.store_id = o.store_id
    JOIN service_tables target ON target.id = NEW.target_table_id AND target.store_id = o.store_id
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND o.status = 'OPEN' AND o.version = NEW.expected_order_version
      AND source.id = NEW.source_table_id AND source.status = 'OCCUPIED'
      AND source.version = NEW.expected_source_version
      AND target.status = 'AVAILABLE' AND target.version = NEW.expected_target_version
  ) THEN RAISE(ABORT, 'TABLE_TRANSFER_CONFLICT') END);
END;

CREATE TRIGGER trg_transfer_table_execute
AFTER INSERT ON transfer_table_commands
BEGIN
  UPDATE orders
  SET table_id = NEW.target_table_id, version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE time_sessions
  SET table_id = NEW.target_table_id, updated_at = NEW.issued_at
  WHERE order_id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE service_tables
  SET status = 'AVAILABLE', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.source_table_id AND store_id = NEW.store_id;

  UPDATE service_tables
  SET status = 'OCCUPIED', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.target_table_id AND store_id = NEW.store_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'TABLE_TRANSFERRED', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('from', NEW.source_table_id, 'to', NEW.target_table_id), NEW.issued_at
  );
END;

CREATE TABLE cancel_order_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  expected_order_version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_cancel_order_validate
BEFORE INSERT ON cancel_order_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND table_id = NEW.table_id AND status = 'OPEN'
      AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
END;

CREATE TRIGGER trg_cancel_order_execute
AFTER INSERT ON cancel_order_commands
BEGIN
  UPDATE orders
  SET status = 'CANCELLED', version = version + 1, cancelled_at = NEW.issued_at,
      cancel_reason = NEW.reason, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE time_sessions
  SET status = 'ENDED', ended_at = NEW.issued_at, updated_at = NEW.issued_at
  WHERE order_id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE service_tables
  SET status = 'AVAILABLE', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.table_id AND store_id = NEW.store_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'ORDER_CANCELLED', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('reason', NEW.reason), NEW.issued_at
  );
END;
