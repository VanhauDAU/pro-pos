PRAGMA foreign_keys = ON;

-- A guest can call the same item more than once during a table session. Keep
-- one editable order line per product/variant/price/note combination instead
-- of creating a new line for every accepted QR request.
DROP TRIGGER IF EXISTS trg_accept_guest_order_execute;
CREATE TRIGGER trg_accept_guest_order_execute
AFTER INSERT ON accept_guest_order_request_commands
BEGIN
  -- Add the accepted quantities to the oldest compatible line. The correlated
  -- SUM also makes a request containing duplicate compatible items deterministic.
  UPDATE order_items
  SET quantity_milli = quantity_milli + (
        SELECT SUM(gri.quantity_milli)
        FROM guest_order_request_items gri
        JOIN products p ON p.id = gri.product_id AND p.store_id = gri.store_id
        WHERE gri.request_id = NEW.guest_request_id
          AND p.product_type <> 'TIME'
          AND gri.product_id = order_items.product_id
          AND gri.variant_id IS order_items.variant_id
          AND gri.unit_price_snapshot = order_items.unit_price_snapshot
          AND gri.note IS order_items.note
      ),
      gross_line_total = CAST((
        unit_price_snapshot * (
          quantity_milli + (
            SELECT SUM(gri.quantity_milli)
            FROM guest_order_request_items gri
            JOIN products p ON p.id = gri.product_id AND p.store_id = gri.store_id
            WHERE gri.request_id = NEW.guest_request_id
              AND p.product_type <> 'TIME'
              AND gri.product_id = order_items.product_id
              AND gri.variant_id IS order_items.variant_id
              AND gri.unit_price_snapshot = order_items.unit_price_snapshot
              AND gri.note IS order_items.note
          )
        ) + 500
      ) / 1000 AS INTEGER),
      net_line_total = CAST((
        unit_price_snapshot * (
          quantity_milli + (
            SELECT SUM(gri.quantity_milli)
            FROM guest_order_request_items gri
            JOIN products p ON p.id = gri.product_id AND p.store_id = gri.store_id
            WHERE gri.request_id = NEW.guest_request_id
              AND p.product_type <> 'TIME'
              AND gri.product_id = order_items.product_id
              AND gri.variant_id IS order_items.variant_id
              AND gri.unit_price_snapshot = order_items.unit_price_snapshot
              AND gri.note IS order_items.note
          )
        ) + 500
      ) / 1000 AS INTEGER),
      line_total = CAST((
        unit_price_snapshot * (
          quantity_milli + (
            SELECT SUM(gri.quantity_milli)
            FROM guest_order_request_items gri
            JOIN products p ON p.id = gri.product_id AND p.store_id = gri.store_id
            WHERE gri.request_id = NEW.guest_request_id
              AND p.product_type <> 'TIME'
              AND gri.product_id = order_items.product_id
              AND gri.variant_id IS order_items.variant_id
              AND gri.unit_price_snapshot = order_items.unit_price_snapshot
              AND gri.note IS order_items.note
          )
        ) + 500
      ) / 1000 AS INTEGER),
      updated_at = NEW.issued_at
  WHERE order_items.store_id = NEW.store_id
    AND order_items.order_id = (
      SELECT order_id FROM guest_order_requests WHERE id = NEW.guest_request_id
    )
    AND order_items.product_type <> 'TIME'
    AND order_items.discount_type IS NULL
    AND order_items.id = (
      SELECT existing.id
      FROM order_items existing
      WHERE existing.store_id = order_items.store_id
        AND existing.order_id = order_items.order_id
        AND existing.product_id = order_items.product_id
        AND existing.variant_id IS order_items.variant_id
        AND existing.unit_price_snapshot = order_items.unit_price_snapshot
        AND existing.note IS order_items.note
        AND existing.product_type <> 'TIME'
        AND existing.discount_type IS NULL
      ORDER BY existing.created_at, existing.id
      LIMIT 1
    )
    AND EXISTS (
      SELECT 1
      FROM guest_order_request_items gri
      JOIN products p ON p.id = gri.product_id AND p.store_id = gri.store_id
      WHERE gri.request_id = NEW.guest_request_id
        AND p.product_type <> 'TIME'
        AND gri.product_id = order_items.product_id
        AND gri.variant_id IS order_items.variant_id
        AND gri.unit_price_snapshot = order_items.unit_price_snapshot
        AND gri.note IS order_items.note
    );

  -- Insert only combinations that did not match an existing line. Grouping
  -- prevents duplicate compatible items inside one guest request as well.
  INSERT INTO order_items (
    id, store_id, order_id, product_id, variant_id, product_type,
    product_name_snapshot, variant_name_snapshot, unit_name_snapshot,
    unit_price_snapshot, quantity_milli, discount_type, discount_value,
    line_total, discount_input_value, discount_amount, gross_line_total,
    net_line_total, added_by, created_at, updated_at, note,
    time_started_at, time_ended_at, source, source_guest_request_id
  )
  SELECT
    lower(hex(randomblob(16))), gri.store_id, gor.order_id, gri.product_id,
    gri.variant_id, p.product_type, MAX(gri.product_name_snapshot),
    MAX(gri.variant_name_snapshot), MAX(gri.unit_name_snapshot),
    gri.unit_price_snapshot, SUM(gri.quantity_milli), NULL, 0,
    CAST((gri.unit_price_snapshot * SUM(gri.quantity_milli) + 500) / 1000 AS INTEGER),
    NULL, 0,
    CAST((gri.unit_price_snapshot * SUM(gri.quantity_milli) + 500) / 1000 AS INTEGER),
    CAST((gri.unit_price_snapshot * SUM(gri.quantity_milli) + 500) / 1000 AS INTEGER),
    NEW.actor_user_id, NEW.issued_at, NEW.issued_at, gri.note,
    NULL, NULL, 'QR_GUEST', gor.id
  FROM guest_order_request_items gri
  JOIN guest_order_requests gor ON gor.id = gri.request_id
  JOIN products p ON p.id = gri.product_id AND p.store_id = gri.store_id
  WHERE gri.request_id = NEW.guest_request_id
    AND NOT EXISTS (
      SELECT 1
      FROM order_items existing
      WHERE existing.store_id = gri.store_id
        AND existing.order_id = gor.order_id
        AND existing.product_id = gri.product_id
        AND existing.variant_id IS gri.variant_id
        AND existing.unit_price_snapshot = gri.unit_price_snapshot
        AND existing.note IS gri.note
        AND existing.product_type <> 'TIME'
        AND existing.discount_type IS NULL
    )
  GROUP BY gri.store_id, gor.order_id, gor.id, gri.product_id, gri.variant_id,
    p.product_type, gri.unit_price_snapshot, gri.note;

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

