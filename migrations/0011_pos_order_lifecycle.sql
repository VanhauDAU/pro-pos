PRAGMA foreign_keys = ON;

-- Item and order notes are mutable while an order is OPEN. Every mutation is
-- guarded by the order version so two POS devices cannot silently overwrite
-- each other.
ALTER TABLE order_items ADD COLUMN note TEXT;
ALTER TABLE takeaway_order_items ADD COLUMN note TEXT;
ALTER TABLE add_item_commands ADD COLUMN item_note TEXT;
ALTER TABLE add_takeaway_item_commands ADD COLUMN item_note TEXT;

DROP TRIGGER trg_add_item_execute;
CREATE TRIGGER trg_add_item_execute
AFTER INSERT ON add_item_commands
BEGIN
  INSERT INTO order_items (
    id, store_id, order_id, product_id, variant_id, product_type,
    product_name_snapshot, variant_name_snapshot, unit_name_snapshot,
    unit_price_snapshot, quantity_milli, discount_type, discount_value,
    line_total, discount_input_value, discount_amount, gross_line_total,
    net_line_total, added_by, created_at, updated_at, note
  ) VALUES (
    NEW.item_id, NEW.store_id, NEW.order_id, NEW.product_id, NEW.variant_id,
    NEW.product_type, NEW.product_name_snapshot, NEW.variant_name_snapshot,
    NEW.unit_name_snapshot, NEW.unit_price_snapshot, NEW.quantity_milli,
    NEW.discount_type, NEW.discount_amount, NEW.net_line_total,
    NEW.discount_input_value, NEW.discount_amount, NEW.gross_line_total,
    NEW.net_line_total, NEW.actor_user_id, NEW.issued_at, NEW.issued_at,
    NEW.item_note
  );

  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;
END;

DROP TRIGGER trg_add_takeaway_item_execute;
CREATE TRIGGER trg_add_takeaway_item_execute
AFTER INSERT ON add_takeaway_item_commands
BEGIN
  INSERT INTO takeaway_order_items (
    id, store_id, order_id, product_id, variant_id, product_type,
    product_name_snapshot, variant_name_snapshot, unit_name_snapshot,
    unit_price_snapshot, quantity_milli, discount_type, discount_input_value,
    discount_amount, gross_line_total, net_line_total, added_by, created_at,
    updated_at, note
  ) VALUES (
    NEW.item_id, NEW.store_id, NEW.order_id, NEW.product_id, NEW.variant_id,
    NEW.product_type, NEW.product_name_snapshot, NEW.variant_name_snapshot,
    NEW.unit_name_snapshot, NEW.unit_price_snapshot, NEW.quantity_milli,
    NEW.discount_type, NEW.discount_input_value, NEW.discount_amount,
    NEW.gross_line_total, NEW.net_line_total, NEW.actor_user_id,
    NEW.issued_at, NEW.issued_at, NEW.item_note
  );

  UPDATE takeaway_orders
  SET version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;
END;

CREATE TABLE update_order_item_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  expected_order_version INTEGER NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  note TEXT,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_update_order_item_validate
BEFORE INSERT ON update_order_item_commands
BEGIN
  SELECT (CASE WHEN NEW.order_type = 'DINE_IN' AND NOT EXISTS (
    SELECT 1 FROM orders o JOIN order_items oi
      ON oi.order_id = o.id AND oi.store_id = o.store_id
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND o.status = 'OPEN' AND o.version = NEW.expected_order_version
      AND oi.id = NEW.item_id
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
  SELECT (CASE WHEN NEW.order_type = 'TAKEAWAY' AND NOT EXISTS (
    SELECT 1 FROM takeaway_orders o JOIN takeaway_order_items oi
      ON oi.order_id = o.id AND oi.store_id = o.store_id
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND o.status = 'OPEN' AND o.version = NEW.expected_order_version
      AND oi.id = NEW.item_id
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
END;

CREATE TRIGGER trg_update_order_item_execute
AFTER INSERT ON update_order_item_commands
BEGIN
  UPDATE order_items
  SET quantity_milli = NEW.quantity_milli,
      gross_line_total = CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
      discount_amount = CASE
        WHEN discount_type = 'PERCENT' THEN MIN(
          CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
          CAST((CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER)
            * discount_input_value + 50) / 100 AS INTEGER)
        )
        WHEN discount_type = 'FIXED' THEN MIN(
          CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
          discount_input_value
        )
        ELSE 0
      END,
      net_line_total = CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER)
        - CASE
          WHEN discount_type = 'PERCENT' THEN MIN(
            CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
            CAST((CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER)
              * discount_input_value + 50) / 100 AS INTEGER)
          )
          WHEN discount_type = 'FIXED' THEN MIN(
            CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
            discount_input_value
          )
          ELSE 0
        END,
      line_total = CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER)
        - CASE
          WHEN discount_type = 'PERCENT' THEN MIN(
            CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
            CAST((CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER)
              * discount_input_value + 50) / 100 AS INTEGER)
          )
          WHEN discount_type = 'FIXED' THEN MIN(
            CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
            discount_input_value
          )
          ELSE 0
        END,
      discount_value = CASE
        WHEN discount_type IS NULL THEN 0
        ELSE CASE
          WHEN discount_type = 'PERCENT' THEN MIN(
            CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
            CAST((CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER)
              * discount_input_value + 50) / 100 AS INTEGER)
          )
          ELSE MIN(
            CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
            discount_input_value
          )
        END
      END,
      note = NEW.note, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'DINE_IN' AND id = NEW.item_id
    AND order_id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE takeaway_order_items
  SET quantity_milli = NEW.quantity_milli,
      gross_line_total = CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
      discount_amount = CASE
        WHEN discount_type = 'PERCENT' THEN MIN(
          CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
          CAST((CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER)
            * discount_input_value + 50) / 100 AS INTEGER)
        )
        WHEN discount_type = 'FIXED' THEN MIN(
          CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
          discount_input_value
        )
        ELSE 0
      END,
      net_line_total = CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER)
        - CASE
          WHEN discount_type = 'PERCENT' THEN MIN(
            CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
            CAST((CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER)
              * discount_input_value + 50) / 100 AS INTEGER)
          )
          WHEN discount_type = 'FIXED' THEN MIN(
            CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
            discount_input_value
          )
          ELSE 0
        END,
      note = NEW.note, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'TAKEAWAY' AND id = NEW.item_id
    AND order_id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'DINE_IN' AND id = NEW.order_id AND store_id = NEW.store_id;
  UPDATE takeaway_orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'TAKEAWAY' AND id = NEW.order_id AND store_id = NEW.store_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'ORDER_ITEM_UPDATED', 'ORDER_ITEM', NEW.item_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'quantityMilli', NEW.quantity_milli,
      'note', NEW.note), NEW.issued_at
  );
END;

CREATE TABLE remove_order_item_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  expected_order_version INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_remove_order_item_validate
BEFORE INSERT ON remove_order_item_commands
BEGIN
  SELECT (CASE WHEN NEW.order_type = 'DINE_IN' AND NOT EXISTS (
    SELECT 1 FROM orders o JOIN order_items oi
      ON oi.order_id = o.id AND oi.store_id = o.store_id
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND o.status = 'OPEN' AND o.version = NEW.expected_order_version
      AND oi.id = NEW.item_id
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
  SELECT (CASE WHEN NEW.order_type = 'TAKEAWAY' AND NOT EXISTS (
    SELECT 1 FROM takeaway_orders o JOIN takeaway_order_items oi
      ON oi.order_id = o.id AND oi.store_id = o.store_id
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND o.status = 'OPEN' AND o.version = NEW.expected_order_version
      AND oi.id = NEW.item_id
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
END;

CREATE TRIGGER trg_remove_order_item_execute
AFTER INSERT ON remove_order_item_commands
BEGIN
  DELETE FROM order_items
  WHERE NEW.order_type = 'DINE_IN' AND id = NEW.item_id
    AND order_id = NEW.order_id AND store_id = NEW.store_id;
  DELETE FROM takeaway_order_items
  WHERE NEW.order_type = 'TAKEAWAY' AND id = NEW.item_id
    AND order_id = NEW.order_id AND store_id = NEW.store_id;
  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'DINE_IN' AND id = NEW.order_id AND store_id = NEW.store_id;
  UPDATE takeaway_orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'TAKEAWAY' AND id = NEW.order_id AND store_id = NEW.store_id;
  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'ORDER_ITEM_REMOVED', 'ORDER_ITEM', NEW.item_id, NEW.request_id,
    json_object('orderId', NEW.order_id), NEW.issued_at
  );
END;

CREATE TABLE update_order_note_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
  order_id TEXT NOT NULL,
  expected_order_version INTEGER NOT NULL,
  note TEXT,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_update_order_note_validate
BEFORE INSERT ON update_order_note_commands
BEGIN
  SELECT (CASE WHEN NEW.order_type = 'DINE_IN' AND NOT EXISTS (
    SELECT 1 FROM orders WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'OPEN' AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
  SELECT (CASE WHEN NEW.order_type = 'TAKEAWAY' AND NOT EXISTS (
    SELECT 1 FROM takeaway_orders WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'OPEN' AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
END;

CREATE TRIGGER trg_update_order_note_execute
AFTER INSERT ON update_order_note_commands
BEGIN
  UPDATE orders SET note = NEW.note, version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'DINE_IN' AND id = NEW.order_id AND store_id = NEW.store_id;
  UPDATE takeaway_orders SET note = NEW.note, version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'TAKEAWAY' AND id = NEW.order_id AND store_id = NEW.store_id;
END;

-- Takeaway checkout mirrors table checkout but deliberately has no time line or
-- table lifecycle. Invoice numbers share the same atomic daily sequence.
CREATE TABLE takeaway_payments (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES takeaway_orders(id),
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

CREATE TABLE takeaway_invoices (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL UNIQUE REFERENCES takeaway_orders(id),
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

CREATE TABLE takeaway_invoice_lines (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  invoice_id TEXT NOT NULL REFERENCES takeaway_invoices(id),
  line_type TEXT NOT NULL CHECK (line_type = 'PRODUCT'),
  description TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  discount_type TEXT CHECK (discount_type IN ('FIXED', 'PERCENT') OR discount_type IS NULL),
  discount_input_value INTEGER,
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  gross_line_total INTEGER NOT NULL CHECK (gross_line_total >= 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  snapshot_json TEXT NOT NULL,
  CHECK (gross_line_total - discount_amount = line_total)
);

CREATE TABLE takeaway_checkout_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES takeaway_orders(id),
  expected_order_version INTEGER NOT NULL,
  payment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  invoice_display_code TEXT NOT NULL,
  method TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount_total INTEGER NOT NULL,
  total INTEGER NOT NULL,
  cash_received INTEGER,
  cash_change INTEGER,
  invoice_snapshot_json TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  business_day TEXT NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_takeaway_checkout_validate
BEFORE INSERT ON takeaway_checkout_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM takeaway_orders WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'OPEN' AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
  SELECT (CASE WHEN EXISTS (
    SELECT 1 FROM takeaway_payments WHERE order_id = NEW.order_id AND status = 'SUCCEEDED'
  ) THEN RAISE(ABORT, 'ORDER_ALREADY_PAID') END);
END;

CREATE TRIGGER trg_takeaway_checkout_execute
AFTER INSERT ON takeaway_checkout_commands
BEGIN
  INSERT INTO invoice_sequences (store_id, business_day, last_value, updated_at)
  VALUES (NEW.store_id, NEW.business_day, 1, NEW.issued_at)
  ON CONFLICT(store_id, business_day) DO UPDATE SET
    last_value = last_value + 1, updated_at = excluded.updated_at;

  UPDATE takeaway_checkout_commands
  SET invoice_display_code = 'HD-' || NEW.business_day || '-' || printf('%06d', (
    SELECT last_value FROM invoice_sequences
    WHERE store_id = NEW.store_id AND business_day = NEW.business_day
  ))
  WHERE store_id = NEW.store_id AND id = NEW.id;

  INSERT INTO takeaway_payments (
    id, store_id, order_id, method, status, amount, cash_received,
    cash_change, idempotency_key, created_by, created_at
  ) VALUES (
    NEW.payment_id, NEW.store_id, NEW.order_id, NEW.method, 'SUCCEEDED',
    NEW.total, NEW.cash_received, NEW.cash_change, NEW.id,
    NEW.actor_user_id, NEW.issued_at
  );

  INSERT INTO takeaway_invoices (
    id, store_id, order_id, display_code, subtotal, discount_total,
    total, status, issued_at, issued_by, snapshot_json
  ) VALUES (
    NEW.invoice_id, NEW.store_id, NEW.order_id,
    'HD-' || NEW.business_day || '-' || printf('%06d', (
      SELECT last_value FROM invoice_sequences
      WHERE store_id = NEW.store_id AND business_day = NEW.business_day
    )), NEW.subtotal, NEW.discount_total, NEW.total, 'COMPLETED',
    NEW.issued_at, NEW.actor_user_id, NEW.invoice_snapshot_json
  );

  INSERT INTO takeaway_invoice_lines (
    id, store_id, invoice_id, line_type, description, quantity_milli,
    unit_price, discount_type, discount_input_value, discount_amount,
    gross_line_total, line_total, snapshot_json
  )
  SELECT lower(hex(randomblob(16))), oi.store_id, NEW.invoice_id, 'PRODUCT',
    oi.product_name_snapshot, oi.quantity_milli, oi.unit_price_snapshot,
    oi.discount_type, oi.discount_input_value, oi.discount_amount,
    oi.gross_line_total, oi.net_line_total,
    json_object('productId', oi.product_id, 'variantId', oi.variant_id,
      'productType', oi.product_type,
      'productName', oi.product_name_snapshot, 'variantName', oi.variant_name_snapshot,
      'unitName', oi.unit_name_snapshot, 'unitPriceVnd', oi.unit_price_snapshot,
      'quantityMilli', oi.quantity_milli, 'note', oi.note,
      'discountAmountVnd', oi.discount_amount, 'grossLineTotalVnd', oi.gross_line_total,
      'netLineTotalVnd', oi.net_line_total)
  FROM takeaway_order_items oi
  WHERE oi.order_id = NEW.order_id AND oi.store_id = NEW.store_id;

  UPDATE takeaway_orders
  SET status = 'PAID', version = version + 1, closed_at = NEW.issued_at,
      updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'CHECKOUT_COMPLETED', 'INVOICE', NEW.invoice_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'subtotal', NEW.subtotal,
      'discountTotal', NEW.discount_total, 'total', NEW.total, 'method', NEW.method),
    NEW.issued_at
  );
END;

CREATE TABLE cancel_takeaway_order_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES takeaway_orders(id),
  expected_order_version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_cancel_takeaway_order_validate
BEFORE INSERT ON cancel_takeaway_order_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM takeaway_orders WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'OPEN' AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
END;

CREATE TRIGGER trg_cancel_takeaway_order_execute
AFTER INSERT ON cancel_takeaway_order_commands
BEGIN
  UPDATE takeaway_orders
  SET status = 'CANCELLED', version = version + 1, cancelled_at = NEW.issued_at,
      cancel_reason = NEW.reason, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;
  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'ORDER_CANCELLED', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('reason', NEW.reason), NEW.issued_at
  );
END;
