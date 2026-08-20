-- A time-priced catalogue item is a session, not a quantity.  Keep its range
-- on the order line so several different time products can be charged on one
-- order (for example, a customer moves from table A pricing to table B).
ALTER TABLE order_items ADD COLUMN time_started_at INTEGER;
ALTER TABLE order_items ADD COLUMN time_ended_at INTEGER;
ALTER TABLE add_item_commands ADD COLUMN time_started_at INTEGER;
ALTER TABLE add_item_commands ADD COLUMN time_ended_at INTEGER;
ALTER TABLE update_order_item_commands ADD COLUMN time_started_at INTEGER;
ALTER TABLE update_order_item_commands ADD COLUMN time_ended_at INTEGER;

DROP TRIGGER trg_add_item_execute;
CREATE TRIGGER trg_add_item_execute
AFTER INSERT ON add_item_commands
BEGIN
  INSERT INTO order_items (
    id, store_id, order_id, product_id, variant_id, product_type,
    product_name_snapshot, variant_name_snapshot, unit_name_snapshot,
    unit_price_snapshot, quantity_milli, discount_type, discount_value,
    line_total, discount_input_value, discount_amount, gross_line_total,
    net_line_total, added_by, created_at, updated_at, note,
    time_started_at, time_ended_at
  ) VALUES (
    NEW.item_id, NEW.store_id, NEW.order_id, NEW.product_id, NEW.variant_id,
    NEW.product_type, NEW.product_name_snapshot, NEW.variant_name_snapshot,
    NEW.unit_name_snapshot, NEW.unit_price_snapshot, NEW.quantity_milli,
    NEW.discount_type, NEW.discount_amount, NEW.net_line_total,
    NEW.discount_input_value, NEW.discount_amount, NEW.gross_line_total,
    NEW.net_line_total, NEW.actor_user_id, NEW.issued_at, NEW.issued_at,
    NEW.item_note, NEW.time_started_at, NEW.time_ended_at
  );
  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;
END;

DROP TRIGGER trg_update_order_item_execute;
CREATE TRIGGER trg_update_order_item_execute
AFTER INSERT ON update_order_item_commands
BEGIN
  UPDATE order_items
  SET quantity_milli = NEW.quantity_milli,
      gross_line_total = CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
      discount_amount = CASE
        WHEN discount_type = 'PERCENT' THEN MIN(CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER), CAST((CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER) * discount_input_value + 50) / 100 AS INTEGER))
        WHEN discount_type = 'FIXED' THEN MIN(CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER), discount_input_value)
        ELSE 0 END,
      net_line_total = CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER) - CASE
        WHEN discount_type = 'PERCENT' THEN MIN(CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER), CAST((CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER) * discount_input_value + 50) / 100 AS INTEGER))
        WHEN discount_type = 'FIXED' THEN MIN(CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER), discount_input_value)
        ELSE 0 END,
      discount_value = CASE WHEN discount_type IS NULL THEN 0 ELSE CASE WHEN discount_type = 'PERCENT' THEN MIN(CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER), CAST((CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER) * discount_input_value + 50) / 100 AS INTEGER)) ELSE MIN(CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER), discount_input_value) END END,
      note = NEW.note, time_started_at = NEW.time_started_at,
      time_ended_at = NEW.time_ended_at, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'DINE_IN' AND id = NEW.item_id
    AND order_id = NEW.order_id AND store_id = NEW.store_id;
  UPDATE takeaway_order_items
  SET quantity_milli = NEW.quantity_milli,
      gross_line_total = CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER),
      discount_amount = CASE
        WHEN discount_type = 'PERCENT' THEN MIN(CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER), CAST((CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER) * discount_input_value + 50) / 100 AS INTEGER))
        WHEN discount_type = 'FIXED' THEN MIN(CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER), discount_input_value)
        ELSE 0 END,
      net_line_total = CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER) - CASE
        WHEN discount_type = 'PERCENT' THEN MIN(CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER), CAST((CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER) * discount_input_value + 50) / 100 AS INTEGER))
        WHEN discount_type = 'FIXED' THEN MIN(CAST((unit_price_snapshot * NEW.quantity_milli + 500) / 1000 AS INTEGER), discount_input_value)
        ELSE 0 END,
      note = NEW.note, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'TAKEAWAY' AND id = NEW.item_id
    AND order_id = NEW.order_id AND store_id = NEW.store_id;
  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'DINE_IN' AND id = NEW.order_id AND store_id = NEW.store_id;
  UPDATE takeaway_orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'TAKEAWAY' AND id = NEW.order_id AND store_id = NEW.store_id;
  INSERT INTO audit_logs (id, store_id, actor_user_id, action, entity_type, entity_id, request_id, after_json, created_at)
  VALUES (lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'ORDER_ITEM_UPDATED', 'ORDER_ITEM', NEW.item_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'quantityMilli', NEW.quantity_milli, 'note', NEW.note), NEW.issued_at);
END;
