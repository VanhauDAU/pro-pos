PRAGMA foreign_keys = ON;

-- 1. Table Open: Only create time session and table time segment if table has pricing configuration (pricing_version > 0)
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
  FROM service_tables st
  WHERE st.id = NEW.table_id AND st.store_id = NEW.store_id
    AND NEW.pricing_version > 0;

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
  FROM service_tables st
  WHERE st.id = NEW.table_id AND st.store_id = NEW.store_id
    AND NEW.pricing_version > 0;

  UPDATE service_tables
  SET status = 'OCCUPIED', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.table_id AND store_id = NEW.store_id;
END;

-- 2. Table Transfer: Handle transfer to/from unpriced tables safely and atomically
DROP TRIGGER IF EXISTS trg_transfer_table_execute;
CREATE TRIGGER trg_transfer_table_execute
AFTER INSERT ON transfer_table_commands
BEGIN
  -- 1. Close current open segment for source table
  UPDATE table_time_segments
  SET ended_at = NEW.issued_at, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id AND ended_at IS NULL;

  -- 2. Insert a segment for a priced target. An ended session whose current
  --    pricing_version is 0 was ended specifically because the order spent time
  --    at an unpriced table, so it is safe to start a new priced segment.
  INSERT INTO table_time_segments (
    id, store_id, order_id, time_session_id, table_id, time_product_id,
    table_name_snapshot, started_at, ended_at, pricing_snapshot_json,
    pricing_version, unit_price_snapshot, created_at, updated_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, NEW.order_id, ts.id,
    target_st.id, target_st.time_product_id, COALESCE(target_st.display_name, target_st.name),
    NEW.issued_at, NULL,
    COALESCE(NEW.target_pricing_snapshot_json, ts.pricing_snapshot_json),
    COALESCE(NEW.target_pricing_version, ts.pricing_version),
    COALESCE(json_extract(COALESCE(NEW.target_pricing_snapshot_json, ts.pricing_snapshot_json), '$.basePriceVnd'), 0),
    NEW.issued_at, NEW.issued_at
  FROM time_sessions ts
  JOIN service_tables target_st ON target_st.id = NEW.target_table_id AND target_st.store_id = NEW.store_id
  WHERE ts.order_id = NEW.order_id AND ts.store_id = NEW.store_id
    AND COALESCE(NEW.target_pricing_version, 0) > 0
    AND (
      ts.status IN ('RUNNING', 'PAUSED')
      OR NOT EXISTS (
        SELECT 1
        FROM service_tables source_st
        JOIN products source_product
          ON source_product.id = source_st.time_product_id
          AND source_product.store_id = source_st.store_id
          AND source_product.is_system = 0
        JOIN time_price_configs source_pricing
          ON source_pricing.product_id = source_product.id
          AND source_pricing.store_id = source_product.store_id
        WHERE source_st.id = NEW.source_table_id
          AND source_st.store_id = NEW.store_id
      )
    );

  -- 3. Update orders table_id and version
  UPDATE orders
  SET table_id = NEW.target_table_id, version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  -- 4. A pause must not remain open while an order is at an unpriced table.
  --    Otherwise a later resume could revive stale state from the priced table.
  UPDATE time_pauses
  SET resumed_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND resumed_at IS NULL
    AND COALESCE(NEW.target_pricing_version, 0) = 0
    AND time_session_id = (
      SELECT id FROM time_sessions
      WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    );

  -- 5. Update the existing session. pricing_version = 0 represents that the
  --    order is currently at an unpriced table. Returning from that state to a
  --    priced table resumes with a fresh segment; moving between unpriced tables
  --    must preserve the original end time and never extend historical charges.
  UPDATE time_sessions
  SET table_id = NEW.target_table_id,
      time_product_id = (SELECT time_product_id FROM service_tables WHERE id = NEW.target_table_id AND store_id = NEW.store_id),
      pricing_snapshot_json = COALESCE(NEW.target_pricing_snapshot_json, pricing_snapshot_json),
      pricing_version = COALESCE(NEW.target_pricing_version, pricing_version),
      status = CASE
        WHEN COALESCE(NEW.target_pricing_version, 0) = 0 THEN 'ENDED'
        WHEN NOT EXISTS (
          SELECT 1
          FROM service_tables source_st
          JOIN products source_product
            ON source_product.id = source_st.time_product_id
            AND source_product.store_id = source_st.store_id
            AND source_product.is_system = 0
          JOIN time_price_configs source_pricing
            ON source_pricing.product_id = source_product.id
            AND source_pricing.store_id = source_product.store_id
          WHERE source_st.id = NEW.source_table_id
            AND source_st.store_id = NEW.store_id
        ) THEN 'RUNNING'
        ELSE status
      END,
      ended_at = CASE
        WHEN COALESCE(NEW.target_pricing_version, 0) = 0 AND EXISTS (
          SELECT 1
          FROM service_tables source_st
          JOIN products source_product
            ON source_product.id = source_st.time_product_id
            AND source_product.store_id = source_st.store_id
            AND source_product.is_system = 0
          JOIN time_price_configs source_pricing
            ON source_pricing.product_id = source_product.id
            AND source_pricing.store_id = source_product.store_id
          WHERE source_st.id = NEW.source_table_id
            AND source_st.store_id = NEW.store_id
        )
          THEN NEW.issued_at
        WHEN COALESCE(NEW.target_pricing_version, 0) = 0
          THEN ended_at
        WHEN NOT EXISTS (
          SELECT 1
          FROM service_tables source_st
          JOIN products source_product
            ON source_product.id = source_st.time_product_id
            AND source_product.store_id = source_st.store_id
            AND source_product.is_system = 0
          JOIN time_price_configs source_pricing
            ON source_pricing.product_id = source_product.id
            AND source_pricing.store_id = source_product.store_id
          WHERE source_st.id = NEW.source_table_id
            AND source_st.store_id = NEW.store_id
        )
          THEN NULL
        ELSE ended_at
      END,
      updated_at = NEW.issued_at
  WHERE order_id = NEW.order_id AND store_id = NEW.store_id;

  -- 6. If moving from an order that never had pricing to a priced table, create
  --    its first time session.
  INSERT INTO time_sessions (
    id, store_id, order_id, table_id, time_product_id, status, started_at,
    pricing_snapshot_json, pricing_version, opened_by, updated_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, NEW.order_id, target_st.id, target_st.time_product_id,
    'RUNNING', NEW.issued_at, NEW.target_pricing_snapshot_json, NEW.target_pricing_version,
    NEW.actor_user_id, NEW.issued_at
  FROM service_tables target_st
  WHERE target_st.id = NEW.target_table_id AND target_st.store_id = NEW.store_id
    AND COALESCE(NEW.target_pricing_version, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM time_sessions existing
      WHERE existing.store_id = NEW.store_id AND existing.order_id = NEW.order_id
    );

  -- 7. If a new time session was created above, insert its initial segment.
  INSERT INTO table_time_segments (
    id, store_id, order_id, time_session_id, table_id, time_product_id,
    table_name_snapshot, started_at, ended_at, pricing_snapshot_json,
    pricing_version, unit_price_snapshot, created_at, updated_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.store_id, NEW.order_id, ts.id,
    target_st.id, target_st.time_product_id, COALESCE(target_st.display_name, target_st.name),
    NEW.issued_at, NULL,
    NEW.target_pricing_snapshot_json, NEW.target_pricing_version,
    COALESCE(json_extract(NEW.target_pricing_snapshot_json, '$.basePriceVnd'), 0),
    NEW.issued_at, NEW.issued_at
  FROM time_sessions ts
  JOIN service_tables target_st ON target_st.id = NEW.target_table_id AND target_st.store_id = NEW.store_id
  WHERE ts.order_id = NEW.order_id AND ts.store_id = NEW.store_id
    AND COALESCE(NEW.target_pricing_version, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM table_time_segments existing
      WHERE existing.store_id = NEW.store_id AND existing.order_id = NEW.order_id
        AND existing.ended_at IS NULL
    );

  -- 8. Release source table to AVAILABLE
  UPDATE service_tables
  SET status = 'AVAILABLE', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.source_table_id AND store_id = NEW.store_id;

  -- 9. Set target table to OCCUPIED
  UPDATE service_tables
  SET status = 'OCCUPIED', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.target_table_id AND store_id = NEW.store_id;

  -- 10. Record audit log
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

-- Starting or reopening an open-ended billing range is only valid while the
-- order's current table has a real pricing configuration. This is enforced at
-- the database boundary so stale clients cannot revive a historical rate after
-- a transfer to an unpriced table.
DROP TRIGGER IF EXISTS trg_update_time_range_validate;
CREATE TRIGGER trg_update_time_range_validate
BEFORE INSERT ON update_time_range_commands
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN time_sessions ts ON ts.order_id = o.id AND ts.store_id = o.store_id
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND o.status = 'OPEN' AND o.version = NEW.expected_order_version
      AND ts.started_at = NEW.previous_started_at
      AND ts.ended_at IS NEW.previous_ended_at
      AND ts.status = NEW.previous_status
  ) THEN RAISE(ABORT, 'ORDER_VERSION_CONFLICT') END);

  SELECT (CASE WHEN NEW.ended_at IS NULL AND NOT EXISTS (
    SELECT 1
    FROM orders o
    JOIN service_tables st ON st.id = o.table_id AND st.store_id = o.store_id
    JOIN products p ON p.id = st.time_product_id AND p.store_id = st.store_id
    JOIN time_price_configs tpc ON tpc.product_id = p.id AND tpc.store_id = p.store_id
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND p.product_type = 'TIME' AND p.status = 'ACTIVE' AND p.is_system = 0
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
    SELECT 1 FROM orders o
    JOIN time_sessions ts ON ts.order_id = o.id AND ts.store_id = o.store_id
    JOIN time_pauses tp ON tp.time_session_id = ts.id AND tp.resumed_at IS NULL
    JOIN service_tables st ON st.id = o.table_id AND st.store_id = o.store_id
    JOIN products p ON p.id = st.time_product_id AND p.store_id = st.store_id
    JOIN time_price_configs tpc ON tpc.product_id = p.id AND tpc.store_id = p.store_id
    WHERE o.id = NEW.order_id AND o.store_id = NEW.store_id
      AND ts.status = 'PAUSED'
      AND p.product_type = 'TIME' AND p.status = 'ACTIVE' AND p.is_system = 0
  ) THEN RAISE(ABORT, 'TIME_NOT_PAUSED') END);
END;
