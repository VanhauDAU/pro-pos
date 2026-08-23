-- Migration 0048: Preserve manually-set end time when resuming from checkout.
--
-- Before this fix: resuming from checkout always reset time_sessions.ended_at = NULL
-- and status = 'RUNNING', discarding any end time the cashier manually entered.
--
-- Fix logic:
--   - A session has a MANUALLY set end time if its ended_at < the stop_time issued_at.
--     (Because migration 0047 ensures stop-time only writes ended_at when it was NULL,
--      so ended_at < stop_issued_at => was set before checkout by update_time_range.)
--   - A session was only stopped by checkout (no manual end) if ended_at >= stop_issued_at.
--
-- On resume:
--   * Non-manually-ended sessions → resume as RUNNING (existing behavior)
--   * Manually-ended sessions     → keep status = ENDED, keep ended_at, keep segments closed

DROP TRIGGER IF EXISTS trg_resume_checkout_execute;
CREATE TRIGGER trg_resume_checkout_execute
AFTER INSERT ON resume_checkout_commands
BEGIN
  -- ── Path A: Session was NOT manually ended (ended_at was NULL before checkout) ──
  -- These rows have ended_at >= stop_issued_at (set by trg_stop_time_execute).

  -- A1. Close any still-open manual pause (covers checkout window).
  UPDATE time_pauses
  SET resumed_at = NEW.issued_at
  WHERE store_id = NEW.store_id
    AND resumed_at IS NULL
    AND time_session_id IN (
      SELECT ts.id FROM time_sessions ts
      JOIN stop_time_commands stc
        ON stc.store_id = NEW.store_id AND stc.order_id = NEW.order_id
        AND stc.id = (
          SELECT id FROM stop_time_commands
          WHERE store_id = NEW.store_id AND order_id = NEW.order_id
            AND issued_at <= NEW.issued_at
          ORDER BY issued_at DESC, id DESC LIMIT 1
        )
      WHERE ts.store_id = NEW.store_id AND ts.order_id = NEW.order_id
        AND ts.ended_at >= stc.issued_at
    );

  -- A2. Insert checkout window as a time_pause for sessions not manually ended.
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
    -- Only for non-manually-ended sessions
    AND ts.ended_at >= stopped.issued_at
    AND stopped.issued_at < NEW.issued_at
    AND NOT EXISTS (
      SELECT 1 FROM time_pauses existing
      WHERE existing.store_id = NEW.store_id
        AND existing.time_session_id = ts.id
        AND existing.paused_at <= stopped.issued_at
        AND COALESCE(existing.resumed_at, NEW.issued_at) >= NEW.issued_at
    );

  -- A3. Reopen the last table_time_segment for non-manually-ended sessions.
  UPDATE table_time_segments
  SET ended_at = NULL, updated_at = NEW.issued_at
  WHERE id IN (
    SELECT tts.id FROM table_time_segments tts
    JOIN time_sessions ts
      ON ts.store_id = NEW.store_id AND ts.order_id = NEW.order_id
    JOIN stop_time_commands stc
      ON stc.store_id = NEW.store_id AND stc.order_id = NEW.order_id
      AND stc.id = (
        SELECT id FROM stop_time_commands
        WHERE store_id = NEW.store_id AND order_id = NEW.order_id
          AND issued_at <= NEW.issued_at
        ORDER BY issued_at DESC, id DESC LIMIT 1
      )
    WHERE tts.store_id = NEW.store_id AND tts.order_id = NEW.order_id
      -- Only if session was NOT manually ended
      AND ts.ended_at >= stc.issued_at
    ORDER BY tts.started_at DESC, tts.id DESC LIMIT 1
  );

  -- A4. (Fallback) Insert initial segment if no segments exist (non-manually-ended).
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
  JOIN stop_time_commands stc
    ON stc.store_id = NEW.store_id AND stc.order_id = NEW.order_id
    AND stc.id = (
      SELECT id FROM stop_time_commands
      WHERE store_id = NEW.store_id AND order_id = NEW.order_id
        AND issued_at <= NEW.issued_at
      ORDER BY issued_at DESC, id DESC LIMIT 1
    )
  WHERE ts.order_id = NEW.order_id AND ts.store_id = NEW.store_id
    -- Only if session was NOT manually ended
    AND ts.ended_at >= stc.issued_at
    AND NOT EXISTS (
      SELECT 1 FROM table_time_segments
      WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    );

  -- A5. Resume time_sessions that were NOT manually ended.
  UPDATE time_sessions
  SET status = 'RUNNING', ended_at = NULL, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    AND ended_at >= (
      SELECT issued_at FROM stop_time_commands
      WHERE store_id = NEW.store_id AND order_id = NEW.order_id
        AND issued_at <= NEW.issued_at
      ORDER BY issued_at DESC LIMIT 1
    );

  -- ── Path B: Session was manually ended (ended_at < stop_issued_at) ──
  -- Keep status = ENDED, keep ended_at, keep table segments closed.
  -- (No additional SQL needed — we simply skip updating those rows.)

  -- ── Common: set order back to OPEN ──
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
