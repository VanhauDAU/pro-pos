PRAGMA foreign_keys = ON;

-- Human-friendly order numbers share one atomic daily sequence across dine-in
-- and takeaway orders. Keeping the full sequence (minimum four digits, never
-- truncating it) makes the compact code collision-free within a store/day.
CREATE TABLE order_sequences (
  store_id TEXT NOT NULL REFERENCES stores(id),
  business_day TEXT NOT NULL,
  last_value INTEGER NOT NULL CHECK (last_value > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, business_day)
);

ALTER TABLE open_table_commands ADD COLUMN business_day TEXT;
ALTER TABLE open_table_commands ADD COLUMN display_code TEXT;
ALTER TABLE create_takeaway_order_commands ADD COLUMN business_day TEXT;

DROP TRIGGER trg_open_table_execute;
CREATE TRIGGER trg_open_table_execute
AFTER INSERT ON open_table_commands
BEGIN
  INSERT INTO order_sequences (store_id, business_day, last_value, updated_at)
  VALUES (NEW.store_id, NEW.business_day, 1, NEW.issued_at)
  ON CONFLICT(store_id, business_day) DO UPDATE SET
    last_value = last_value + 1, updated_at = excluded.updated_at;

  UPDATE open_table_commands
  SET display_code = 'D' || substr(NEW.business_day, 3) || '-' || printf('%04d', (
    SELECT last_value FROM order_sequences
    WHERE store_id = NEW.store_id AND business_day = NEW.business_day
  ))
  WHERE store_id = NEW.store_id AND id = NEW.id;

  INSERT INTO orders (
    id, store_id, table_id, status, version, opened_by, opened_at, created_at,
    updated_at, display_code
  ) VALUES (
    NEW.order_id, NEW.store_id, NEW.table_id, 'OPEN', 1,
    NEW.actor_user_id, NEW.issued_at, NEW.issued_at, NEW.issued_at,
    (SELECT display_code FROM open_table_commands
     WHERE store_id = NEW.store_id AND id = NEW.id)
  );

  INSERT INTO time_sessions (
    id, store_id, order_id, table_id, time_product_id, status, started_at,
    pricing_snapshot_json, pricing_version, opened_by, updated_at
  )
  SELECT NEW.time_session_id, NEW.store_id, NEW.order_id, st.id, st.time_product_id,
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
    json_object('tableId', NEW.table_id, 'orderId', NEW.order_id, 'displayCode',
      (SELECT display_code FROM open_table_commands
       WHERE store_id = NEW.store_id AND id = NEW.id)), NEW.issued_at
  );
END;

DROP TRIGGER trg_create_takeaway_order_execute;
CREATE TRIGGER trg_create_takeaway_order_execute
AFTER INSERT ON create_takeaway_order_commands
BEGIN
  INSERT INTO order_sequences (store_id, business_day, last_value, updated_at)
  VALUES (NEW.store_id, NEW.business_day, 1, NEW.issued_at)
  ON CONFLICT(store_id, business_day) DO UPDATE SET
    last_value = last_value + 1, updated_at = excluded.updated_at;

  UPDATE create_takeaway_order_commands
  SET display_code = 'D' || substr(NEW.business_day, 3) || '-' || printf('%04d', (
    SELECT last_value FROM order_sequences
    WHERE store_id = NEW.store_id AND business_day = NEW.business_day
  ))
  WHERE store_id = NEW.store_id AND id = NEW.id;

  INSERT INTO takeaway_orders (
    id, store_id, display_code, status, version, opened_by, opened_at,
    note, created_at, updated_at
  ) VALUES (
    NEW.order_id, NEW.store_id,
    (SELECT display_code FROM create_takeaway_order_commands
     WHERE store_id = NEW.store_id AND id = NEW.id),
    'OPEN', 1, NEW.actor_user_id, NEW.issued_at, NEW.note, NEW.issued_at, NEW.issued_at
  );

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'TAKEAWAY_ORDER_CREATED', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'displayCode',
      (SELECT display_code FROM create_takeaway_order_commands
       WHERE store_id = NEW.store_id AND id = NEW.id)), NEW.issued_at
  );
END;

-- Give pre-existing dine-in orders a deterministic legacy code before adding
-- the uniqueness guarantee. New codes always use the DYYMMDD-NNNN format.
UPDATE orders
SET display_code = 'DLEG-' || printf('%08d', rowid)
WHERE display_code IS NULL OR display_code = '';

CREATE UNIQUE INDEX uq_orders_store_display_code
  ON orders(store_id, display_code) WHERE display_code IS NOT NULL;

-- Compact previously generated invoice numbers without losing any sequence
-- digits. HD-20260821-000001 becomes H260821-0001.
UPDATE invoices
SET display_code = 'H' || substr(display_code, 6, 6) || '-' ||
  printf('%04d', CAST(substr(display_code, 13) AS INTEGER))
WHERE display_code GLOB 'HD-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9]*';

UPDATE checkout_commands
SET invoice_display_code = 'H' || substr(invoice_display_code, 6, 6) || '-' ||
  printf('%04d', CAST(substr(invoice_display_code, 13) AS INTEGER))
WHERE invoice_display_code GLOB 'HD-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9]*';

UPDATE takeaway_invoices
SET display_code = 'H' || substr(display_code, 6, 6) || '-' ||
  printf('%04d', CAST(substr(display_code, 13) AS INTEGER))
WHERE display_code GLOB 'HD-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9]*';

UPDATE takeaway_checkout_commands
SET invoice_display_code = 'H' || substr(invoice_display_code, 6, 6) || '-' ||
  printf('%04d', CAST(substr(invoice_display_code, 13) AS INTEGER))
WHERE invoice_display_code GLOB 'HD-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9]*';

DROP TRIGGER trg_checkout_execute;
CREATE TRIGGER trg_checkout_execute
AFTER INSERT ON checkout_commands
BEGIN
  INSERT INTO invoice_sequences (store_id, business_day, last_value, updated_at)
  VALUES (NEW.store_id, NEW.business_day, 1, NEW.issued_at)
  ON CONFLICT(store_id, business_day) DO UPDATE SET
    last_value = last_value + 1, updated_at = excluded.updated_at;

  UPDATE checkout_commands
  SET invoice_display_code = 'H' || substr(NEW.business_day, 3) || '-' || printf('%04d', (
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
    (SELECT invoice_display_code FROM checkout_commands
     WHERE store_id = NEW.store_id AND id = NEW.id),
    NEW.subtotal, NEW.discount_total, NEW.total, 'COMPLETED',
    NEW.issued_at, NEW.actor_user_id, NEW.invoice_snapshot_json
  );

  INSERT INTO invoice_lines (
    id, store_id, invoice_id, line_type, description, quantity_milli,
    unit_price, discount_amount, line_total, snapshot_json,
    discount_type, discount_input_value, gross_line_total
  )
  SELECT lower(hex(randomblob(16))), oi.store_id, NEW.invoice_id, 'PRODUCT',
    oi.product_name_snapshot, oi.quantity_milli, oi.unit_price_snapshot,
    oi.discount_amount, oi.net_line_total,
    json_object('productId', oi.product_id, 'variantId', oi.variant_id,
      'productType', oi.product_type,
      'productName', oi.product_name_snapshot, 'variantName', oi.variant_name_snapshot,
      'unitName', oi.unit_name_snapshot, 'unitPriceVnd', oi.unit_price_snapshot,
      'quantityMilli', oi.quantity_milli, 'discountType', oi.discount_type,
      'discountInputValue', oi.discount_input_value, 'discountAmountVnd', oi.discount_amount,
      'grossLineTotalVnd', oi.gross_line_total, 'netLineTotalVnd', oi.net_line_total),
    oi.discount_type, oi.discount_input_value, oi.gross_line_total
  FROM order_items oi
  WHERE oi.order_id = NEW.order_id AND oi.store_id = NEW.store_id;

  INSERT INTO invoice_lines (
    id, store_id, invoice_id, line_type, description, quantity_milli,
    unit_price, discount_amount, line_total, snapshot_json,
    discount_type, discount_input_value, gross_line_total
  )
  SELECT lower(hex(randomblob(16))), NEW.store_id, NEW.invoice_id, 'TIME',
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

DROP TRIGGER trg_takeaway_checkout_execute;
CREATE TRIGGER trg_takeaway_checkout_execute
AFTER INSERT ON takeaway_checkout_commands
BEGIN
  INSERT INTO invoice_sequences (store_id, business_day, last_value, updated_at)
  VALUES (NEW.store_id, NEW.business_day, 1, NEW.issued_at)
  ON CONFLICT(store_id, business_day) DO UPDATE SET
    last_value = last_value + 1, updated_at = excluded.updated_at;

  UPDATE takeaway_checkout_commands
  SET invoice_display_code = 'H' || substr(NEW.business_day, 3) || '-' || printf('%04d', (
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
    (SELECT invoice_display_code FROM takeaway_checkout_commands
     WHERE store_id = NEW.store_id AND id = NEW.id),
    NEW.subtotal, NEW.discount_total, NEW.total, 'COMPLETED',
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
