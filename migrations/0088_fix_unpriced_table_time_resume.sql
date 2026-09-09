PRAGMA foreign_keys = ON;

-- Migration 0087 may already have been applied on a running installation. In
-- that version, transferring an order from an unpriced table back to a priced
-- table created the new open segment but could leave the parent session ENDED.
-- Repair only that inconsistent shape: an open order on a priced table with an
-- open current-table segment whose start is not earlier than the stale end.
UPDATE time_sessions AS session
SET status = 'RUNNING', ended_at = NULL, updated_at = (
  SELECT MAX(segment.updated_at)
  FROM table_time_segments segment
  WHERE segment.store_id = session.store_id
    AND segment.order_id = session.order_id
    AND segment.ended_at IS NULL
)
WHERE session.status = 'ENDED'
  AND session.ended_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM orders current_order
    JOIN service_tables current_table
      ON current_table.id = current_order.table_id
      AND current_table.store_id = current_order.store_id
    JOIN products current_product
      ON current_product.id = current_table.time_product_id
      AND current_product.store_id = current_table.store_id
      AND current_product.is_system = 0
    JOIN time_price_configs current_pricing
      ON current_pricing.product_id = current_product.id
      AND current_pricing.store_id = current_product.store_id
    WHERE current_order.id = session.order_id
      AND current_order.store_id = session.store_id
      AND current_order.status = 'OPEN'
  )
  AND EXISTS (
    SELECT 1
    FROM table_time_segments open_segment
    WHERE open_segment.store_id = session.store_id
      AND open_segment.order_id = session.order_id
      AND open_segment.table_id = session.table_id
      AND open_segment.ended_at IS NULL
      AND open_segment.started_at >= session.ended_at
  );

-- Keep transfer state atomic for every transition:
-- priced -> unpriced: close billing;
-- unpriced -> unpriced: preserve the historical end;
-- unpriced -> priced: start a fresh segment and resume immediately;
-- priced -> priced: preserve the existing running/paused/ended state.
DROP TRIGGER IF EXISTS trg_transfer_table_execute;
CREATE TRIGGER trg_transfer_table_execute
AFTER INSERT ON transfer_table_commands
BEGIN
  UPDATE table_time_segments
  SET ended_at = NEW.issued_at, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id AND ended_at IS NULL;

  INSERT INTO table_time_segments (
    id, store_id, order_id, time_session_id, table_id, time_product_id,
    table_name_snapshot, started_at, ended_at, pricing_snapshot_json,
    pricing_version, unit_price_snapshot, created_at, updated_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, NEW.order_id, session.id,
    target_table.id, target_table.time_product_id,
    COALESCE(target_table.display_name, target_table.name),
    NEW.issued_at, NULL, NEW.target_pricing_snapshot_json,
    NEW.target_pricing_version,
    COALESCE(json_extract(NEW.target_pricing_snapshot_json, '$.basePriceVnd'), 0),
    NEW.issued_at, NEW.issued_at
  FROM time_sessions session
  JOIN service_tables target_table
    ON target_table.id = NEW.target_table_id
    AND target_table.store_id = NEW.store_id
  WHERE session.order_id = NEW.order_id
    AND session.store_id = NEW.store_id
    AND COALESCE(NEW.target_pricing_version, 0) > 0
    AND (
      session.status IN ('RUNNING', 'PAUSED')
      OR NOT EXISTS (
        SELECT 1
        FROM service_tables source_table
        JOIN products source_product
          ON source_product.id = source_table.time_product_id
          AND source_product.store_id = source_table.store_id
          AND source_product.is_system = 0
        JOIN time_price_configs source_pricing
          ON source_pricing.product_id = source_product.id
          AND source_pricing.store_id = source_product.store_id
        WHERE source_table.id = NEW.source_table_id
          AND source_table.store_id = NEW.store_id
      )
    );

  UPDATE orders
  SET table_id = NEW.target_table_id, version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  UPDATE time_pauses
  SET resumed_at = NEW.issued_at
  WHERE store_id = NEW.store_id
    AND resumed_at IS NULL
    AND COALESCE(NEW.target_pricing_version, 0) = 0
    AND time_session_id = (
      SELECT id FROM time_sessions
      WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    );

  UPDATE time_sessions
  SET table_id = NEW.target_table_id,
      time_product_id = (
        SELECT time_product_id
        FROM service_tables
        WHERE id = NEW.target_table_id AND store_id = NEW.store_id
      ),
      pricing_snapshot_json = NEW.target_pricing_snapshot_json,
      pricing_version = NEW.target_pricing_version,
      status = CASE
        WHEN COALESCE(NEW.target_pricing_version, 0) = 0 THEN 'ENDED'
        WHEN NOT EXISTS (
          SELECT 1
          FROM service_tables source_table
          JOIN products source_product
            ON source_product.id = source_table.time_product_id
            AND source_product.store_id = source_table.store_id
            AND source_product.is_system = 0
          JOIN time_price_configs source_pricing
            ON source_pricing.product_id = source_product.id
            AND source_pricing.store_id = source_product.store_id
          WHERE source_table.id = NEW.source_table_id
            AND source_table.store_id = NEW.store_id
        ) THEN 'RUNNING'
        ELSE status
      END,
      ended_at = CASE
        WHEN COALESCE(NEW.target_pricing_version, 0) = 0 AND EXISTS (
          SELECT 1
          FROM service_tables source_table
          JOIN products source_product
            ON source_product.id = source_table.time_product_id
            AND source_product.store_id = source_table.store_id
            AND source_product.is_system = 0
          JOIN time_price_configs source_pricing
            ON source_pricing.product_id = source_product.id
            AND source_pricing.store_id = source_product.store_id
          WHERE source_table.id = NEW.source_table_id
            AND source_table.store_id = NEW.store_id
        ) THEN NEW.issued_at
        WHEN COALESCE(NEW.target_pricing_version, 0) = 0 THEN ended_at
        WHEN NOT EXISTS (
          SELECT 1
          FROM service_tables source_table
          JOIN products source_product
            ON source_product.id = source_table.time_product_id
            AND source_product.store_id = source_table.store_id
            AND source_product.is_system = 0
          JOIN time_price_configs source_pricing
            ON source_pricing.product_id = source_product.id
            AND source_pricing.store_id = source_product.store_id
          WHERE source_table.id = NEW.source_table_id
            AND source_table.store_id = NEW.store_id
        ) THEN NULL
        ELSE ended_at
      END,
      updated_at = NEW.issued_at
  WHERE order_id = NEW.order_id AND store_id = NEW.store_id;

  INSERT INTO time_sessions (
    id, store_id, order_id, table_id, time_product_id, status, started_at,
    pricing_snapshot_json, pricing_version, opened_by, updated_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, NEW.order_id,
    target_table.id, target_table.time_product_id, 'RUNNING', NEW.issued_at,
    NEW.target_pricing_snapshot_json, NEW.target_pricing_version,
    NEW.actor_user_id, NEW.issued_at
  FROM service_tables target_table
  WHERE target_table.id = NEW.target_table_id
    AND target_table.store_id = NEW.store_id
    AND COALESCE(NEW.target_pricing_version, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM time_sessions existing
      WHERE existing.store_id = NEW.store_id AND existing.order_id = NEW.order_id
    );

  INSERT INTO table_time_segments (
    id, store_id, order_id, time_session_id, table_id, time_product_id,
    table_name_snapshot, started_at, ended_at, pricing_snapshot_json,
    pricing_version, unit_price_snapshot, created_at, updated_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, NEW.order_id, session.id,
    target_table.id, target_table.time_product_id,
    COALESCE(target_table.display_name, target_table.name),
    NEW.issued_at, NULL, NEW.target_pricing_snapshot_json,
    NEW.target_pricing_version,
    COALESCE(json_extract(NEW.target_pricing_snapshot_json, '$.basePriceVnd'), 0),
    NEW.issued_at, NEW.issued_at
  FROM time_sessions session
  JOIN service_tables target_table
    ON target_table.id = NEW.target_table_id
    AND target_table.store_id = NEW.store_id
  WHERE session.order_id = NEW.order_id
    AND session.store_id = NEW.store_id
    AND COALESCE(NEW.target_pricing_version, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM table_time_segments existing
      WHERE existing.store_id = NEW.store_id
        AND existing.order_id = NEW.order_id
        AND existing.ended_at IS NULL
    );

  UPDATE service_tables
  SET status = 'AVAILABLE', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.source_table_id AND store_id = NEW.store_id;

  UPDATE service_tables
  SET status = 'OCCUPIED', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.target_table_id AND store_id = NEW.store_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    'TABLE_TRANSFERRED', 'ORDER', NEW.order_id, NEW.request_id,
    json_object(
      'fromTableId', NEW.source_table_id,
      'toTableId', NEW.target_table_id,
      'orderId', NEW.order_id,
      'transferredAt', NEW.issued_at
    ),
    NEW.issued_at
  );
END;

-- A stale client must not reopen historical billing while the order is on an
-- unpriced table.
DROP TRIGGER IF EXISTS trg_update_time_range_validate;
CREATE TRIGGER trg_update_time_range_validate
BEFORE INSERT ON update_time_range_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders current_order
    JOIN time_sessions session
      ON session.order_id = current_order.id
      AND session.store_id = current_order.store_id
    WHERE current_order.id = NEW.order_id
      AND current_order.store_id = NEW.store_id
      AND current_order.status = 'OPEN'
      AND current_order.version = NEW.expected_order_version
      AND session.started_at = NEW.previous_started_at
      AND session.ended_at IS NEW.previous_ended_at
      AND session.status = NEW.previous_status
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);

  SELECT (CASE WHEN NEW.ended_at IS NULL AND NOT EXISTS (
    SELECT 1
    FROM orders current_order
    JOIN service_tables current_table
      ON current_table.id = current_order.table_id
      AND current_table.store_id = current_order.store_id
    JOIN products current_product
      ON current_product.id = current_table.time_product_id
      AND current_product.store_id = current_table.store_id
    JOIN time_price_configs current_pricing
      ON current_pricing.product_id = current_product.id
      AND current_pricing.store_id = current_product.store_id
    WHERE current_order.id = NEW.order_id
      AND current_order.store_id = NEW.store_id
      AND current_product.product_type = 'TIME'
      AND current_product.status = 'ACTIVE'
      AND current_product.is_system = 0
  ) THEN RAISE(ABORT, 'TABLE_PRICING_MISSING') END);
END;

DROP TRIGGER IF EXISTS trg_resume_time_validate;
CREATE TRIGGER trg_resume_time_validate
BEFORE INSERT ON resume_time_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id AND store_id = NEW.store_id
      AND status = 'OPEN' AND version = NEW.expected_order_version
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);

  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders current_order
    JOIN time_sessions session
      ON session.order_id = current_order.id
      AND session.store_id = current_order.store_id
    JOIN time_pauses pause
      ON pause.time_session_id = session.id AND pause.resumed_at IS NULL
    JOIN service_tables current_table
      ON current_table.id = current_order.table_id
      AND current_table.store_id = current_order.store_id
    JOIN products current_product
      ON current_product.id = current_table.time_product_id
      AND current_product.store_id = current_table.store_id
    JOIN time_price_configs current_pricing
      ON current_pricing.product_id = current_product.id
      AND current_pricing.store_id = current_product.store_id
    WHERE current_order.id = NEW.order_id
      AND current_order.store_id = NEW.store_id
      AND session.status = 'PAUSED'
      AND current_product.product_type = 'TIME'
      AND current_product.status = 'ACTIVE'
      AND current_product.is_system = 0
  ) THEN RAISE(ABORT, 'TIME_NOT_PAUSED') END);
END;
