PRAGMA foreign_keys = ON;

-- 1. Table Open: separate business execution from audit logging
DROP TRIGGER IF EXISTS trg_open_table_execute;
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

  INSERT INTO table_time_segments (
    id, store_id, order_id, time_session_id, table_id, time_product_id,
    table_name_snapshot, started_at, ended_at, pricing_snapshot_json,
    pricing_version, unit_price_snapshot, created_at, updated_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, NEW.order_id, NEW.time_session_id,
    st.id, st.time_product_id, COALESCE(st.display_name, st.name), NEW.issued_at, NULL,
    NEW.pricing_snapshot_json, NEW.pricing_version,
    COALESCE(json_extract(NEW.pricing_snapshot_json, '$.basePriceVnd'), 0),
    NEW.issued_at, NEW.issued_at
  FROM service_tables st WHERE st.id = NEW.table_id AND st.store_id = NEW.store_id;

  UPDATE service_tables
  SET status = 'OCCUPIED', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.table_id AND store_id = NEW.store_id;
END;

DROP TRIGGER IF EXISTS trg_open_table_audit;
CREATE TRIGGER trg_open_table_audit
AFTER INSERT ON open_table_commands
WHEN NOT EXISTS (
  SELECT 1 FROM realtime_batch_contexts context
  WHERE context.store_id = NEW.store_id
    AND substr(NEW.id, 1, length(context.command_id) + 1) = context.command_id || ':'
)
BEGIN
  INSERT INTO audit_logs (
    id, store_id, actor_user_id, device_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id, NULL,
    'TABLE_OPENED', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('tableId', NEW.table_id, 'orderId', NEW.order_id), NEW.issued_at
  );
END;

-- 2. Takeaway Order Create: separate business execution from audit logging
DROP TRIGGER IF EXISTS trg_create_takeaway_order_execute;
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
END;

DROP TRIGGER IF EXISTS trg_create_takeaway_order_audit;
CREATE TRIGGER trg_create_takeaway_order_audit
AFTER INSERT ON create_takeaway_order_commands
WHEN NOT EXISTS (
  SELECT 1 FROM realtime_batch_contexts context
  WHERE context.store_id = NEW.store_id
    AND substr(NEW.id, 1, length(context.command_id) + 1) = context.command_id || ':'
)
BEGIN
  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'TAKEAWAY_ORDER_CREATED', 'ORDER', NEW.order_id, NEW.request_id,
    json_object(
      'orderId', NEW.order_id,
      'displayCode', COALESCE(
        (SELECT display_code FROM create_takeaway_order_commands WHERE store_id = NEW.store_id AND id = NEW.id),
        (SELECT display_code FROM takeaway_orders WHERE store_id = NEW.store_id AND id = NEW.order_id),
        (SELECT 'D' || substr(NEW.business_day, 3) || '-' || printf('%04d', last_value) FROM order_sequences WHERE store_id = NEW.store_id AND business_day = NEW.business_day)
      )
    ),
    NEW.issued_at
  );
END;

-- 3. Update Order Item: separate business execution from audit logging
DROP TRIGGER IF EXISTS trg_update_order_item_execute;
CREATE TRIGGER trg_update_order_item_execute
AFTER INSERT ON update_order_item_commands
BEGIN
  UPDATE order_items
  SET quantity_milli = NEW.quantity_milli,
      variant_id = CASE WHEN NEW.variant_id IS NOT NULL THEN NEW.variant_id ELSE variant_id END,
      variant_name_snapshot = CASE WHEN NEW.variant_name_snapshot IS NOT NULL THEN NEW.variant_name_snapshot ELSE variant_name_snapshot END,
      unit_price_snapshot = COALESCE(NEW.unit_price_snapshot, unit_price_snapshot),
      discount_type = CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END,
      discount_input_value = CASE WHEN NEW.discount_input_value IS NOT NULL THEN (CASE WHEN NEW.discount_input_value < 0 THEN NULL ELSE NEW.discount_input_value END) ELSE discount_input_value END,
      discount_amount = COALESCE(NEW.discount_amount,
        CASE
          WHEN (CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END) = 'PERCENT'
            THEN MIN(CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER), CAST((CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER) * (CASE WHEN NEW.discount_input_value IS NOT NULL THEN NEW.discount_input_value ELSE discount_input_value END) + 50) / 100 AS INTEGER))
          WHEN (CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END) = 'FIXED'
            THEN MIN(CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER), (CASE WHEN NEW.discount_input_value IS NOT NULL THEN NEW.discount_input_value ELSE discount_input_value END))
          ELSE 0
        END
      ),
      gross_line_total = COALESCE(NEW.gross_line_total, CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER)),
      net_line_total = COALESCE(NEW.net_line_total,
        CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER) - COALESCE(NEW.discount_amount,
          CASE
            WHEN (CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END) = 'PERCENT'
              THEN MIN(CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER), CAST((CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER) * (CASE WHEN NEW.discount_input_value IS NOT NULL THEN NEW.discount_input_value ELSE discount_input_value END) + 50) / 100 AS INTEGER))
            WHEN (CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END) = 'FIXED'
              THEN MIN(CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER), (CASE WHEN NEW.discount_input_value IS NOT NULL THEN NEW.discount_input_value ELSE discount_input_value END))
            ELSE 0
          END
        )
      ),
      discount_value = COALESCE(NEW.discount_amount,
        CASE
          WHEN (CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END) IS NULL THEN 0
          WHEN (CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END) = 'PERCENT'
            THEN MIN(CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER), CAST((CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER) * (CASE WHEN NEW.discount_input_value IS NOT NULL THEN NEW.discount_input_value ELSE discount_input_value END) + 50) / 100 AS INTEGER))
          ELSE MIN(CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER), (CASE WHEN NEW.discount_input_value IS NOT NULL THEN NEW.discount_input_value ELSE discount_input_value END))
        END
      ),
      note = NEW.note,
      time_started_at = NEW.time_started_at,
      time_ended_at = NEW.time_ended_at,
      updated_at = NEW.issued_at
  WHERE NEW.order_type = 'DINE_IN' AND id = NEW.item_id
    AND order_id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE takeaway_order_items
  SET quantity_milli = NEW.quantity_milli,
      variant_id = CASE WHEN NEW.variant_id IS NOT NULL THEN NEW.variant_id ELSE variant_id END,
      variant_name_snapshot = CASE WHEN NEW.variant_name_snapshot IS NOT NULL THEN NEW.variant_name_snapshot ELSE variant_name_snapshot END,
      unit_price_snapshot = COALESCE(NEW.unit_price_snapshot, unit_price_snapshot),
      discount_type = CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END,
      discount_input_value = CASE WHEN NEW.discount_input_value IS NOT NULL THEN (CASE WHEN NEW.discount_input_value < 0 THEN NULL ELSE NEW.discount_input_value END) ELSE discount_input_value END,
      discount_amount = COALESCE(NEW.discount_amount,
        CASE
          WHEN (CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END) = 'PERCENT'
            THEN MIN(CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER), CAST((CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER) * (CASE WHEN NEW.discount_input_value IS NOT NULL THEN NEW.discount_input_value ELSE discount_input_value END) + 50) / 100 AS INTEGER))
          WHEN (CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END) = 'FIXED'
            THEN MIN(CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER), (CASE WHEN NEW.discount_input_value IS NOT NULL THEN NEW.discount_input_value ELSE discount_input_value END))
          ELSE 0
        END
      ),
      gross_line_total = COALESCE(NEW.gross_line_total, CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER)),
      net_line_total = COALESCE(NEW.net_line_total,
        CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER) - COALESCE(NEW.discount_amount,
          CASE
            WHEN (CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END) = 'PERCENT'
              THEN MIN(CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER), CAST((CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER) * (CASE WHEN NEW.discount_input_value IS NOT NULL THEN NEW.discount_input_value ELSE discount_input_value END) + 50) / 100 AS INTEGER))
            WHEN (CASE WHEN NEW.discount_type IS NOT NULL THEN (CASE WHEN NEW.discount_type = 'NONE' THEN NULL ELSE NEW.discount_type END) ELSE discount_type END) = 'FIXED'
              THEN MIN(CAST((COALESCE(NEW.unit_price_snapshot, unit_price_snapshot) * NEW.quantity_milli + 500) / 1000 AS INTEGER), (CASE WHEN NEW.discount_input_value IS NOT NULL THEN NEW.discount_input_value ELSE discount_input_value END))
            ELSE 0
          END
        )
      ),
      note = NEW.note,
      updated_at = NEW.issued_at
  WHERE NEW.order_type = 'TAKEAWAY' AND id = NEW.item_id
    AND order_id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'DINE_IN' AND id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE takeaway_orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'TAKEAWAY' AND id = NEW.order_id AND store_id = NEW.store_id;
END;

DROP TRIGGER IF EXISTS trg_update_order_item_audit;
CREATE TRIGGER trg_update_order_item_audit
AFTER INSERT ON update_order_item_commands
WHEN NOT EXISTS (
  SELECT 1 FROM realtime_batch_contexts context
  WHERE context.store_id = NEW.store_id
    AND substr(NEW.id, 1, length(context.command_id) + 1) = context.command_id || ':'
)
BEGIN
  INSERT INTO audit_logs (id, store_id, actor_user_id, action, entity_type, entity_id, request_id, after_json, created_at)
  VALUES (lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'ORDER_ITEM_UPDATED', 'ORDER_ITEM', NEW.item_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'quantityMilli', NEW.quantity_milli, 'note', NEW.note, 'variantId', NEW.variant_id), NEW.issued_at);
END;

-- 4. Remove Order Item: separate business execution from audit logging
DROP TRIGGER IF EXISTS trg_remove_order_item_execute;
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
END;

DROP TRIGGER IF EXISTS trg_remove_order_item_audit;
CREATE TRIGGER trg_remove_order_item_audit
AFTER INSERT ON remove_order_item_commands
WHEN NOT EXISTS (
  SELECT 1 FROM realtime_batch_contexts context
  WHERE context.store_id = NEW.store_id
    AND substr(NEW.id, 1, length(context.command_id) + 1) = context.command_id || ':'
)
BEGIN
  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'ORDER_ITEM_REMOVED', 'ORDER_ITEM', NEW.item_id, NEW.request_id,
    json_object('orderId', NEW.order_id), NEW.issued_at
  );
END;
