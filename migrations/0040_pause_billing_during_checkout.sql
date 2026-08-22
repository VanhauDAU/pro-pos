PRAGMA foreign_keys = ON;

-- A checkout attempt is a real billing pause. If the cashier returns to the
-- order, reopen the existing segment (so it is not shown as a table transfer)
-- and exclude the checkout interval through time_pauses.
DROP TRIGGER IF EXISTS trg_resume_checkout_execute;
CREATE TRIGGER trg_resume_checkout_execute
AFTER INSERT ON resume_checkout_commands
BEGIN
  -- If the table was manually paused before checkout, resuming from checkout
  -- also resumes that pause. It already covers the checkout interval.
  UPDATE time_pauses
  SET resumed_at = NEW.issued_at
  WHERE store_id = NEW.store_id
    AND resumed_at IS NULL
    AND time_session_id = (
      SELECT id FROM time_sessions
      WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    );

  -- Normal running tables do not have an open pause, so record the frozen
  -- checkout window now. The overlap guard avoids double-counting a manual
  -- pause that was closed by the statement above.
  INSERT INTO time_pauses (
    id, store_id, time_session_id, paused_at, resumed_at,
    actor_user_id, created_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, ts.id, stopped.issued_at,
    NEW.issued_at, NEW.actor_user_id, stopped.issued_at
  FROM time_sessions ts
  JOIN stop_time_commands stopped
    ON stopped.id = (
      SELECT id FROM stop_time_commands
      WHERE store_id = NEW.store_id AND order_id = NEW.order_id
        AND issued_at <= NEW.issued_at
      ORDER BY issued_at DESC, id DESC LIMIT 1
    )
  WHERE ts.store_id = NEW.store_id AND ts.order_id = NEW.order_id
    AND stopped.issued_at < NEW.issued_at
    AND NOT EXISTS (
      SELECT 1 FROM time_pauses existing
      WHERE existing.store_id = NEW.store_id
        AND existing.time_session_id = ts.id
        AND existing.paused_at <= stopped.issued_at
        AND COALESCE(existing.resumed_at, NEW.issued_at) >= NEW.issued_at
    );

  UPDATE table_time_segments
  SET ended_at = NULL, updated_at = NEW.issued_at
  WHERE id = (
    SELECT id FROM table_time_segments
    WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    ORDER BY started_at DESC, id DESC LIMIT 1
  );

  INSERT INTO table_time_segments (
    id, store_id, order_id, time_session_id, table_id, time_product_id,
    table_name_snapshot, started_at, ended_at, pricing_snapshot_json,
    pricing_version, unit_price_snapshot, created_at, updated_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, NEW.order_id, ts.id,
    ts.table_id, ts.time_product_id, COALESCE(st.display_name, st.name),
    ts.started_at, NULL, ts.pricing_snapshot_json, ts.pricing_version,
    COALESCE(json_extract(ts.pricing_snapshot_json, '$.basePriceVnd'), 0),
    NEW.issued_at, NEW.issued_at
  FROM time_sessions ts
  JOIN service_tables st ON st.id = ts.table_id AND st.store_id = NEW.store_id
  WHERE ts.order_id = NEW.order_id AND ts.store_id = NEW.store_id
    AND NOT EXISTS (
      SELECT 1 FROM table_time_segments
      WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    );

  UPDATE time_sessions
  SET status = 'RUNNING', ended_at = NULL, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  UPDATE orders
  SET status = 'OPEN', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, device_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id, NEW.device_id,
    'ORDER_RESUMED_FROM_CHECKOUT', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('orderId', NEW.order_id, 'resumedAt', NEW.issued_at,
      'checkoutBillingPaused', 1), NEW.issued_at
  );
END;
