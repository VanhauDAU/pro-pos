PRAGMA foreign_keys = ON;

-- Entering checkout still freezes the displayed quote until the cashier makes
-- an explicit choice. If checkout is abandoned and the cashier resumes the
-- order, billing continues from the original start time and includes the
-- checkout window as one continuous interval.
--
-- Migration 0048 preserved manually-entered end times, but also persisted the
-- checkout window as a time_pause. That pause split the pricing breakdown and
-- excluded the window from the hourly charge. Remove only those generated
-- checkout pauses from active orders; genuine manual pauses remain untouched.
DELETE FROM time_pauses
WHERE EXISTS (
  SELECT 1
  FROM time_sessions ts
  JOIN orders o
    ON o.id = ts.order_id AND o.store_id = ts.store_id
  WHERE ts.id = time_pauses.time_session_id
    AND ts.store_id = time_pauses.store_id
    AND o.status IN ('OPEN', 'PAYMENT_PENDING')
    AND EXISTS (
      SELECT 1
      FROM stop_time_commands stopped
      JOIN resume_checkout_commands resumed
        ON resumed.store_id = stopped.store_id
        AND resumed.order_id = stopped.order_id
        AND resumed.issued_at >= stopped.issued_at
      WHERE stopped.store_id = ts.store_id
        AND stopped.order_id = ts.order_id
        AND time_pauses.paused_at = stopped.issued_at
        AND time_pauses.resumed_at = resumed.issued_at
    )
);

DROP TRIGGER IF EXISTS trg_resume_checkout_execute;
CREATE TRIGGER trg_resume_checkout_execute
AFTER INSERT ON resume_checkout_commands
BEGIN
  -- Resuming checkout also closes a genuine manual pause that was active when
  -- checkout began. Its elapsed interval remains excluded from billing.
  UPDATE time_pauses
  SET resumed_at = NEW.issued_at
  WHERE store_id = NEW.store_id
    AND resumed_at IS NULL
    AND time_session_id IN (
      SELECT ts.id
      FROM time_sessions ts
      JOIN stop_time_commands stopped
        ON stopped.id = (
          SELECT id
          FROM stop_time_commands
          WHERE store_id = NEW.store_id AND order_id = NEW.order_id
            AND issued_at <= NEW.issued_at
          ORDER BY issued_at DESC, id DESC LIMIT 1
        )
      WHERE ts.store_id = NEW.store_id AND ts.order_id = NEW.order_id
        AND ts.ended_at >= stopped.issued_at
    );

  -- Reopen the existing table/rate segment. This keeps both the UI breakdown
  -- and the pricing calculation on one continuous interval.
  UPDATE table_time_segments
  SET ended_at = NULL, updated_at = NEW.issued_at
  WHERE id IN (
    SELECT tts.id
    FROM table_time_segments tts
    JOIN time_sessions ts
      ON ts.id = tts.time_session_id
      AND ts.store_id = tts.store_id
      AND ts.order_id = tts.order_id
    JOIN stop_time_commands stopped
      ON stopped.id = (
        SELECT id
        FROM stop_time_commands
        WHERE store_id = NEW.store_id AND order_id = NEW.order_id
          AND issued_at <= NEW.issued_at
        ORDER BY issued_at DESC, id DESC LIMIT 1
      )
    WHERE tts.store_id = NEW.store_id AND tts.order_id = NEW.order_id
      AND ts.ended_at >= stopped.issued_at
    ORDER BY tts.started_at DESC, tts.id DESC LIMIT 1
  );

  -- Defensive fallback for legacy sessions that have no table segment.
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
  JOIN service_tables st
    ON st.id = ts.table_id AND st.store_id = NEW.store_id
  JOIN stop_time_commands stopped
    ON stopped.id = (
      SELECT id
      FROM stop_time_commands
      WHERE store_id = NEW.store_id AND order_id = NEW.order_id
        AND issued_at <= NEW.issued_at
      ORDER BY issued_at DESC, id DESC LIMIT 1
    )
  WHERE ts.store_id = NEW.store_id AND ts.order_id = NEW.order_id
    AND ts.ended_at >= stopped.issued_at
    AND NOT EXISTS (
      SELECT 1
      FROM table_time_segments
      WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    );

  -- A manually-entered end time predating checkout remains authoritative.
  UPDATE time_sessions
  SET status = 'RUNNING', ended_at = NULL, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    AND ended_at >= (
      SELECT issued_at
      FROM stop_time_commands
      WHERE store_id = NEW.store_id AND order_id = NEW.order_id
        AND issued_at <= NEW.issued_at
      ORDER BY issued_at DESC, id DESC LIMIT 1
    );

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
      'continuousBilling', 1), NEW.issued_at
  );
END;
