PRAGMA foreign_keys = ON;

-- V1 intentionally supports exactly one store membership per user. SUPER_ADMIN users
-- have no store membership, so this invariant does not affect platform bootstrap.
CREATE UNIQUE INDEX uq_store_memberships_user_v1 ON store_memberships(user_id);

-- Preserve the legacy columns for backward reads while making all new accounting
-- semantics explicit. Existing PERCENT rows cannot recover the original percentage;
-- discount_input_value is therefore NULL for those historical rows. Legacy line_total
-- was capped at zero, so gross is reconstructed from the immutable unit-price snapshot
-- and the effective discount is capped at gross during the upgrade.
ALTER TABLE order_items ADD COLUMN discount_input_value INTEGER;
ALTER TABLE order_items ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE order_items ADD COLUMN gross_line_total INTEGER NOT NULL DEFAULT 0 CHECK (gross_line_total >= 0);
ALTER TABLE order_items ADD COLUMN net_line_total INTEGER NOT NULL DEFAULT 0 CHECK (net_line_total >= 0);

UPDATE order_items
SET discount_input_value = CASE WHEN discount_type = 'FIXED' THEN discount_value ELSE NULL END,
    discount_amount = CASE
      WHEN discount_type IS NULL THEN 0
      ELSE MIN(
        CAST((unit_price_snapshot * quantity_milli + 500) / 1000 AS INTEGER),
        discount_value
      )
    END,
    gross_line_total = CAST((unit_price_snapshot * quantity_milli + 500) / 1000 AS INTEGER),
    net_line_total = line_total;

ALTER TABLE add_item_commands ADD COLUMN discount_input_value INTEGER;
ALTER TABLE add_item_commands ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE add_item_commands ADD COLUMN gross_line_total INTEGER NOT NULL DEFAULT 0 CHECK (gross_line_total >= 0);
ALTER TABLE add_item_commands ADD COLUMN net_line_total INTEGER NOT NULL DEFAULT 0 CHECK (net_line_total >= 0);

UPDATE add_item_commands
SET discount_input_value = CASE WHEN discount_type = 'FIXED' THEN discount_value ELSE NULL END,
    discount_amount = CASE
      WHEN discount_type IS NULL THEN 0
      ELSE MIN(
        CAST((unit_price_snapshot * quantity_milli + 500) / 1000 AS INTEGER),
        discount_value
      )
    END,
    gross_line_total = CAST((unit_price_snapshot * quantity_milli + 500) / 1000 AS INTEGER),
    net_line_total = line_total;

ALTER TABLE invoice_lines ADD COLUMN discount_type TEXT CHECK (discount_type IN ('FIXED', 'PERCENT') OR discount_type IS NULL);
ALTER TABLE invoice_lines ADD COLUMN discount_input_value INTEGER;
ALTER TABLE invoice_lines ADD COLUMN gross_line_total INTEGER NOT NULL DEFAULT 0 CHECK (gross_line_total >= 0);

UPDATE invoice_lines
SET gross_line_total = CASE
  WHEN line_type = 'TIME' THEN line_total
  ELSE CAST((unit_price * quantity_milli + 500) / 1000 AS INTEGER)
END;

UPDATE invoice_lines
SET discount_amount = MIN(gross_line_total, discount_amount)
WHERE line_type = 'PRODUCT';

CREATE TRIGGER trg_add_item_accounting_validate
BEFORE INSERT ON add_item_commands
BEGIN
  SELECT (CASE WHEN NEW.discount_amount < 0
    OR NEW.gross_line_total < 0
    OR NEW.net_line_total < 0
    OR NEW.discount_amount > NEW.gross_line_total
    OR NEW.gross_line_total - NEW.discount_amount <> NEW.net_line_total
    OR (NEW.discount_type = 'PERCENT' AND (
      NEW.discount_input_value IS NULL OR NEW.discount_input_value < 0 OR NEW.discount_input_value > 100
    ))
  THEN RAISE(ABORT, 'DISCOUNT_INVALID') END);
END;

CREATE TRIGGER trg_order_item_accounting_validate
BEFORE INSERT ON order_items
BEGIN
  SELECT (CASE WHEN NEW.discount_amount < 0
    OR NEW.gross_line_total < 0
    OR NEW.net_line_total < 0
    OR NEW.discount_amount > NEW.gross_line_total
    OR NEW.gross_line_total - NEW.discount_amount <> NEW.net_line_total
  THEN RAISE(ABORT, 'DISCOUNT_INVALID') END);
END;

CREATE TRIGGER trg_invoice_line_accounting_validate
BEFORE INSERT ON invoice_lines
BEGIN
  SELECT (CASE WHEN NEW.discount_amount < 0
    OR NEW.gross_line_total < 0
    OR NEW.discount_amount > NEW.gross_line_total
    OR NEW.gross_line_total - NEW.discount_amount <> NEW.line_total
  THEN RAISE(ABORT, 'DISCOUNT_INVALID') END);
END;

DROP TRIGGER trg_add_item_execute;
CREATE TRIGGER trg_add_item_execute
AFTER INSERT ON add_item_commands
BEGIN
  INSERT INTO order_items (
    id, store_id, order_id, product_id, variant_id, product_type,
    product_name_snapshot, variant_name_snapshot, unit_name_snapshot,
    unit_price_snapshot, quantity_milli, discount_type, discount_value,
    line_total, discount_input_value, discount_amount, gross_line_total,
    net_line_total, added_by, created_at, updated_at
  ) VALUES (
    NEW.item_id, NEW.store_id, NEW.order_id, NEW.product_id, NEW.variant_id,
    NEW.product_type, NEW.product_name_snapshot, NEW.variant_name_snapshot,
    NEW.unit_name_snapshot, NEW.unit_price_snapshot, NEW.quantity_milli,
    NEW.discount_type, NEW.discount_amount, NEW.net_line_total,
    NEW.discount_input_value, NEW.discount_amount, NEW.gross_line_total,
    NEW.net_line_total, NEW.actor_user_id, NEW.issued_at, NEW.issued_at
  );

  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;
END;

-- Atomic, store-local daily invoice sequence. The checkout command and sequence
-- allocation execute in the same SQLite transaction through the trigger.
CREATE TABLE invoice_sequences (
  store_id TEXT NOT NULL REFERENCES stores(id),
  business_day TEXT NOT NULL,
  last_value INTEGER NOT NULL CHECK (last_value > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, business_day)
);

ALTER TABLE checkout_commands ADD COLUMN business_day TEXT;

DROP TRIGGER trg_checkout_execute;
CREATE TRIGGER trg_checkout_execute
AFTER INSERT ON checkout_commands
BEGIN
  INSERT INTO invoice_sequences (store_id, business_day, last_value, updated_at)
  VALUES (NEW.store_id, NEW.business_day, 1, NEW.issued_at)
  ON CONFLICT(store_id, business_day) DO UPDATE SET
    last_value = last_value + 1,
    updated_at = excluded.updated_at;

  UPDATE checkout_commands
  SET invoice_display_code = 'HD-' || NEW.business_day || '-' || printf('%06d', (
    SELECT last_value FROM invoice_sequences
    WHERE store_id = NEW.store_id AND business_day = NEW.business_day
  ))
  WHERE store_id = NEW.store_id AND id = NEW.id;

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
    NEW.invoice_id, NEW.store_id, NEW.order_id,
    'HD-' || NEW.business_day || '-' || printf('%06d', (
      SELECT last_value FROM invoice_sequences
      WHERE store_id = NEW.store_id AND business_day = NEW.business_day
    )),
    NEW.subtotal, NEW.discount_total, NEW.total, 'COMPLETED',
    NEW.issued_at, NEW.actor_user_id, NEW.invoice_snapshot_json
  );

  INSERT INTO invoice_lines (
    id, store_id, invoice_id, line_type, description, quantity_milli,
    unit_price, discount_amount, line_total, snapshot_json,
    discount_type, discount_input_value, gross_line_total
  )
  SELECT
    lower(hex(randomblob(16))), oi.store_id, NEW.invoice_id, 'PRODUCT',
    oi.product_name_snapshot, oi.quantity_milli, oi.unit_price_snapshot,
    oi.discount_amount, oi.net_line_total,
    json_object(
      'productId', oi.product_id,
      'variantId', oi.variant_id,
      'productName', oi.product_name_snapshot,
      'variantName', oi.variant_name_snapshot,
      'unitName', oi.unit_name_snapshot,
      'unitPriceVnd', oi.unit_price_snapshot,
      'quantityMilli', oi.quantity_milli,
      'discountType', oi.discount_type,
      'discountInputValue', oi.discount_input_value,
      'discountAmountVnd', oi.discount_amount,
      'grossLineTotalVnd', oi.gross_line_total,
      'netLineTotalVnd', oi.net_line_total
    ),
    oi.discount_type, oi.discount_input_value, oi.gross_line_total
  FROM order_items oi
  WHERE oi.order_id = NEW.order_id AND oi.store_id = NEW.store_id;

  INSERT INTO invoice_lines (
    id, store_id, invoice_id, line_type, description, quantity_milli,
    unit_price, discount_amount, line_total, snapshot_json,
    discount_type, discount_input_value, gross_line_total
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, NEW.invoice_id, 'TIME',
    NEW.time_line_description, NEW.time_elapsed_seconds * 1000,
    NEW.time_amount, 0, NEW.time_amount, NEW.time_snapshot_json,
    NULL, NULL, NEW.time_amount
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
    json_object('orderId', NEW.order_id, 'subtotal', NEW.subtotal,
      'discountTotal', NEW.discount_total, 'total', NEW.total, 'method', NEW.method),
    NEW.issued_at
  );
END;

-- Pause/resume use command tables so validation failure aborts before any business
-- row is mutated. The command id is the user intent's Idempotency-Key.
CREATE TABLE pause_time_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  expected_order_version INTEGER NOT NULL,
  pause_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  actor_session_id TEXT REFERENCES auth_sessions(id),
  device_id TEXT REFERENCES devices(id),
  request_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  UNIQUE (store_id, id)
);

CREATE TRIGGER trg_pause_time_validate
BEFORE INSERT ON pause_time_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN time_sessions ts ON ts.order_id = o.id AND ts.store_id = o.store_id
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND o.status = 'OPEN' AND o.version = NEW.expected_order_version
      AND ts.status = 'RUNNING'
      AND NOT EXISTS (
        SELECT 1 FROM time_pauses tp
        WHERE tp.time_session_id = ts.id AND tp.resumed_at IS NULL
      )
  ) THEN RAISE(ABORT, 'TIME_NOT_RUNNING') END);
END;

CREATE TRIGGER trg_pause_time_execute
AFTER INSERT ON pause_time_commands
BEGIN
  INSERT INTO time_pauses (
    id, store_id, time_session_id, paused_at, actor_user_id, created_at
  ) SELECT NEW.pause_id, NEW.store_id, id, NEW.issued_at, NEW.actor_user_id, NEW.issued_at
    FROM time_sessions WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  UPDATE time_sessions SET status = 'PAUSED', updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND id = NEW.order_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, actor_session_id, device_id, action,
    entity_type, entity_id, request_id, before_json, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    NEW.actor_session_id, NEW.device_id, 'TIME_PAUSED', 'ORDER', NEW.order_id,
    NEW.request_id, json_object('timeStatus', 'RUNNING', 'orderVersion', NEW.expected_order_version),
    json_object('timeStatus', 'PAUSED', 'orderVersion', NEW.expected_order_version + 1), NEW.issued_at
  );
END;

CREATE TABLE resume_time_commands (
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

CREATE TRIGGER trg_resume_time_validate
BEFORE INSERT ON resume_time_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN time_sessions ts ON ts.order_id = o.id AND ts.store_id = o.store_id
    JOIN time_pauses tp ON tp.time_session_id = ts.id AND tp.resumed_at IS NULL
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND o.status = 'OPEN' AND o.version = NEW.expected_order_version
      AND ts.status = 'PAUSED'
  ) THEN RAISE(ABORT, 'TIME_NOT_PAUSED') END);
END;

CREATE TRIGGER trg_resume_time_execute
AFTER INSERT ON resume_time_commands
BEGIN
  UPDATE time_pauses SET resumed_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND resumed_at IS NULL
    AND time_session_id = (
      SELECT id FROM time_sessions WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    );

  UPDATE time_sessions SET status = 'RUNNING', updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND id = NEW.order_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, actor_session_id, device_id, action,
    entity_type, entity_id, request_id, before_json, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    NEW.actor_session_id, NEW.device_id, 'TIME_RESUMED', 'ORDER', NEW.order_id,
    NEW.request_id, json_object('timeStatus', 'PAUSED', 'orderVersion', NEW.expected_order_version),
    json_object('timeStatus', 'RUNNING', 'orderVersion', NEW.expected_order_version + 1), NEW.issued_at
  );
END;

DROP TRIGGER trg_pause_time_validate;
CREATE TRIGGER trg_pause_time_validate
BEFORE INSERT ON pause_time_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'OPEN' AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN time_sessions ts ON ts.order_id = o.id AND ts.store_id = o.store_id
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND ts.status = 'RUNNING'
      AND NOT EXISTS (
        SELECT 1 FROM time_pauses tp
        WHERE tp.time_session_id = ts.id AND tp.resumed_at IS NULL
      )
  ) THEN RAISE(ABORT, 'TIME_NOT_RUNNING') END);
END;

DROP TRIGGER trg_resume_time_validate;
CREATE TRIGGER trg_resume_time_validate
BEFORE INSERT ON resume_time_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'OPEN' AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN time_sessions ts ON ts.order_id = o.id AND ts.store_id = o.store_id
    JOIN time_pauses tp ON tp.time_session_id = ts.id AND tp.resumed_at IS NULL
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id AND ts.status = 'PAUSED'
  ) THEN RAISE(ABORT, 'TIME_NOT_PAUSED') END);
END;

-- Tenant-safe client supplied references. Service validation provides the public
-- error contract; these triggers are the final database boundary.
CREATE TRIGGER trg_products_tenant_refs_insert
BEFORE INSERT ON products
BEGIN
  SELECT (CASE WHEN NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories WHERE id = NEW.category_id AND store_id = NEW.store_id AND status = 'ACTIVE'
  ) THEN RAISE(ABORT, 'CATEGORY_REFERENCE_INVALID') END);
  SELECT (CASE WHEN NEW.unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM units WHERE id = NEW.unit_id AND store_id = NEW.store_id
  ) THEN RAISE(ABORT, 'UNIT_REFERENCE_INVALID') END);
END;

CREATE TRIGGER trg_products_tenant_refs_update
BEFORE UPDATE OF store_id, category_id, unit_id ON products
BEGIN
  SELECT (CASE WHEN NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories WHERE id = NEW.category_id AND store_id = NEW.store_id AND status = 'ACTIVE'
  ) THEN RAISE(ABORT, 'CATEGORY_REFERENCE_INVALID') END);
  SELECT (CASE WHEN NEW.unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM units WHERE id = NEW.unit_id AND store_id = NEW.store_id
  ) THEN RAISE(ABORT, 'UNIT_REFERENCE_INVALID') END);
END;

CREATE TRIGGER trg_store_settings_bank_qr_insert
BEFORE INSERT ON store_settings
WHEN NEW.bank_qr_media_id IS NOT NULL
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM media_objects
    WHERE id = NEW.bank_qr_media_id AND store_id = NEW.store_id
      AND status = 'ACTIVE' AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
  ) THEN RAISE(ABORT, 'BANK_QR_MEDIA_INVALID') END);
END;

CREATE TRIGGER trg_store_settings_bank_qr_update
BEFORE UPDATE OF bank_qr_media_id ON store_settings
WHEN NEW.bank_qr_media_id IS NOT NULL
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM media_objects
    WHERE id = NEW.bank_qr_media_id AND store_id = NEW.store_id
      AND status = 'ACTIVE' AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
  ) THEN RAISE(ABORT, 'BANK_QR_MEDIA_INVALID') END);
END;

CREATE TRIGGER trg_service_tables_tenant_refs_insert
BEFORE INSERT ON service_tables
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM areas WHERE id = NEW.area_id AND store_id = NEW.store_id AND status = 'ACTIVE'
  ) THEN RAISE(ABORT, 'AREA_REFERENCE_INVALID') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM products WHERE id = NEW.time_product_id AND store_id = NEW.store_id
      AND status = 'ACTIVE' AND product_type = 'TIME'
  ) THEN RAISE(ABORT, 'TIME_PRODUCT_REFERENCE_INVALID') END);
END;

CREATE TRIGGER trg_service_tables_tenant_refs_update
BEFORE UPDATE OF store_id, area_id, time_product_id ON service_tables
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM areas WHERE id = NEW.area_id AND store_id = NEW.store_id AND status = 'ACTIVE'
  ) THEN RAISE(ABORT, 'AREA_REFERENCE_INVALID') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM products WHERE id = NEW.time_product_id AND store_id = NEW.store_id
      AND status = 'ACTIVE' AND product_type = 'TIME'
  ) THEN RAISE(ABORT, 'TIME_PRODUCT_REFERENCE_INVALID') END);
END;
