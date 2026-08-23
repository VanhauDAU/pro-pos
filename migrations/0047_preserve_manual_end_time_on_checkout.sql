-- Migration 0047: Preserve manually-set end time when entering checkout.
-- If the cashier has already manually set an end time via "Chi tiết tính giờ"
-- (update_time_range_commands), the stop-time trigger must NOT overwrite it.
-- Only sessions that are still running (ended_at IS NULL) should be closed at now.

DROP TRIGGER IF EXISTS trg_stop_time_execute;
CREATE TRIGGER trg_stop_time_execute
AFTER INSERT ON stop_time_commands
BEGIN
  -- 1. Close active table_time_segments (only those that are still open)
  UPDATE table_time_segments
  SET ended_at = MAX(started_at, NEW.issued_at), updated_at = MAX(started_at, NEW.issued_at)
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id AND ended_at IS NULL;

  -- 2. Update time_sessions status to ENDED.
  --    Only overwrite ended_at if it has not already been set manually.
  UPDATE time_sessions
  SET
    status = 'ENDED',
    ended_at = CASE
      WHEN ended_at IS NULL THEN MAX(started_at, NEW.issued_at)
      ELSE ended_at
    END,
    updated_at = MAX(started_at, NEW.issued_at)
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  -- 3. Update orders status to PAYMENT_PENDING
  UPDATE orders
  SET status = 'PAYMENT_PENDING', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  -- 4. Record audit log
  INSERT INTO audit_logs (
    id, store_id, actor_user_id, device_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id, NEW.device_id,
    'ORDER_CHECKOUT_PENDING', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'stoppedAt', NEW.issued_at),
    NEW.issued_at
  );
END;
