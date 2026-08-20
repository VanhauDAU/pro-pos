PRAGMA foreign_keys = ON;

-- Keep the mature table/time order model intact. Takeaway orders have no table
-- or time-session lifecycle, so they live in an additive store-scoped table.
ALTER TABLE orders ADD COLUMN order_type TEXT NOT NULL DEFAULT 'DINE_IN'
  CHECK (order_type = 'DINE_IN');
ALTER TABLE orders ADD COLUMN display_code TEXT;

CREATE TABLE takeaway_orders (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  display_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PAYMENT_PENDING', 'PAID', 'CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1,
  opened_by TEXT NOT NULL REFERENCES users(id),
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  cancelled_at INTEGER,
  cancel_reason TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, display_code)
);

CREATE TABLE takeaway_order_items (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES takeaway_orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT REFERENCES product_variants(id),
  product_type TEXT NOT NULL CHECK (product_type IN ('QUANTITY', 'WEIGHT')),
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT,
  unit_name_snapshot TEXT,
  unit_price_snapshot INTEGER NOT NULL CHECK (unit_price_snapshot >= 0),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  discount_type TEXT CHECK (discount_type IN ('FIXED', 'PERCENT') OR discount_type IS NULL),
  discount_input_value INTEGER,
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  gross_line_total INTEGER NOT NULL CHECK (gross_line_total >= 0),
  net_line_total INTEGER NOT NULL CHECK (net_line_total >= 0),
  added_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (gross_line_total - discount_amount = net_line_total)
);

CREATE INDEX idx_takeaway_orders_store_status_opened
  ON takeaway_orders(store_id, status, opened_at);
CREATE INDEX idx_takeaway_order_items_order
  ON takeaway_order_items(order_id);

CREATE TABLE create_takeaway_order_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL,
  display_code TEXT NOT NULL,
  note TEXT,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_create_takeaway_order_execute
AFTER INSERT ON create_takeaway_order_commands
BEGIN
  INSERT INTO takeaway_orders (
    id, store_id, display_code, status, version, opened_by, opened_at,
    note, created_at, updated_at
  ) VALUES (
    NEW.order_id, NEW.store_id, NEW.display_code, 'OPEN', 1,
    NEW.actor_user_id, NEW.issued_at, NEW.note, NEW.issued_at, NEW.issued_at
  );

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'TAKEAWAY_ORDER_CREATED', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'displayCode', NEW.display_code), NEW.issued_at
  );
END;

CREATE TABLE add_takeaway_item_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES takeaway_orders(id),
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
  discount_input_value INTEGER,
  discount_amount INTEGER NOT NULL,
  gross_line_total INTEGER NOT NULL,
  net_line_total INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_add_takeaway_item_validate
BEFORE INSERT ON add_takeaway_item_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM takeaway_orders
    WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'OPEN' AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
END;

CREATE TRIGGER trg_add_takeaway_item_execute
AFTER INSERT ON add_takeaway_item_commands
BEGIN
  INSERT INTO takeaway_order_items (
    id, store_id, order_id, product_id, variant_id, product_type,
    product_name_snapshot, variant_name_snapshot, unit_name_snapshot,
    unit_price_snapshot, quantity_milli, discount_type, discount_input_value,
    discount_amount, gross_line_total, net_line_total, added_by, created_at, updated_at
  ) VALUES (
    NEW.item_id, NEW.store_id, NEW.order_id, NEW.product_id, NEW.variant_id,
    NEW.product_type, NEW.product_name_snapshot, NEW.variant_name_snapshot,
    NEW.unit_name_snapshot, NEW.unit_price_snapshot, NEW.quantity_milli,
    NEW.discount_type, NEW.discount_input_value, NEW.discount_amount,
    NEW.gross_line_total, NEW.net_line_total, NEW.actor_user_id,
    NEW.issued_at, NEW.issued_at
  );

  UPDATE takeaway_orders
  SET version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;
END;
