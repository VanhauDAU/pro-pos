PRAGMA foreign_keys = ON;

ALTER TABLE order_items ADD COLUMN source TEXT NOT NULL DEFAULT 'POS'
  CHECK (source IN ('POS', 'QR_GUEST', 'ADMIN'));
ALTER TABLE order_items ADD COLUMN source_guest_request_id TEXT;

DROP TRIGGER IF EXISTS trg_accept_guest_order_execute;
CREATE TRIGGER trg_accept_guest_order_execute
AFTER INSERT ON accept_guest_order_request_commands
BEGIN
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
    gri.variant_id, 'QUANTITY', gri.product_name_snapshot,
    gri.variant_name_snapshot, gri.unit_name_snapshot, gri.unit_price_snapshot,
    gri.quantity_milli, NULL, 0, gri.gross_line_total, NULL, 0,
    gri.gross_line_total, gri.gross_line_total, NEW.actor_user_id,
    NEW.issued_at, NEW.issued_at, gri.note, NULL, NULL, 'QR_GUEST', gor.id
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

CREATE INDEX idx_order_items_guest_source
  ON order_items(source_guest_request_id)
  WHERE source = 'QR_GUEST';
