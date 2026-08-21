-- ============================================================
-- MIGRATION 0017: UPDATE ORDER ITEM VARIANT AND DISCOUNT
-- ============================================================

ALTER TABLE update_order_item_commands ADD COLUMN variant_id TEXT;
ALTER TABLE update_order_item_commands ADD COLUMN variant_name_snapshot TEXT;
ALTER TABLE update_order_item_commands ADD COLUMN unit_price_snapshot INTEGER;
ALTER TABLE update_order_item_commands ADD COLUMN discount_type TEXT;
ALTER TABLE update_order_item_commands ADD COLUMN discount_input_value INTEGER;
ALTER TABLE update_order_item_commands ADD COLUMN discount_amount INTEGER;
ALTER TABLE update_order_item_commands ADD COLUMN gross_line_total INTEGER;
ALTER TABLE update_order_item_commands ADD COLUMN net_line_total INTEGER;

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

  INSERT INTO audit_logs (id, store_id, actor_user_id, action, entity_type, entity_id, request_id, after_json, created_at)
  VALUES (lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'ORDER_ITEM_UPDATED', 'ORDER_ITEM', NEW.item_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'quantityMilli', NEW.quantity_milli, 'note', NEW.note, 'variantId', NEW.variant_id), NEW.issued_at);
END;
