-- Multi-segment table time tracking for table transfers.
-- Preserves the active session and order while tracking each table segment with its own pricing.

CREATE TABLE table_time_segments (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  time_session_id TEXT NOT NULL REFERENCES time_sessions(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  time_product_id TEXT NOT NULL REFERENCES products(id),
  table_name_snapshot TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  pricing_snapshot_json TEXT NOT NULL,
  pricing_version INTEGER NOT NULL,
  unit_price_snapshot INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX idx_table_time_segments_session ON table_time_segments(store_id, time_session_id, started_at);

-- Backfill table_time_segments from existing time_sessions
INSERT INTO table_time_segments (
  id, store_id, order_id, time_session_id, table_id, time_product_id,
  table_name_snapshot, started_at, ended_at, pricing_snapshot_json,
  pricing_version, unit_price_snapshot, created_at, updated_at
)
SELECT
  ts.id, ts.store_id, ts.order_id, ts.id, ts.table_id, ts.time_product_id,
  COALESCE(st.display_name, st.name, 'Bàn'), ts.started_at, ts.ended_at,
  ts.pricing_snapshot_json, ts.pricing_version,
  COALESCE(json_extract(ts.pricing_snapshot_json, '$.basePriceVnd'), 0),
  ts.started_at, ts.updated_at
FROM time_sessions ts
LEFT JOIN service_tables st ON st.id = ts.table_id;

-- Update trg_open_table_execute to create the initial segment
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
  FROM service_tables st WHERE st.id = NEW.table_id AND st.store_id = NEW.store_id;

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
  FROM service_tables st WHERE st.id = NEW.table_id AND st.store_id = NEW.store_id;

  UPDATE service_tables
  SET status = 'OCCUPIED', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.table_id AND store_id = NEW.store_id;

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, device_id, action, entity_type, entity_id,
    request_id, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id, NULL,
    'TABLE_OPENED', 'ORDER', NEW.order_id, NEW.request_id,
    json_object('tableId', NEW.table_id, 'orderId', NEW.order_id), NEW.issued_at
  );
END;

-- Add target table pricing columns to transfer_table_commands
ALTER TABLE transfer_table_commands ADD COLUMN target_pricing_snapshot_json TEXT;
ALTER TABLE transfer_table_commands ADD COLUMN target_pricing_version INTEGER;

-- Update trg_transfer_table_execute to handle table segments and new pricing atomically
DROP TRIGGER IF EXISTS trg_transfer_table_execute;
CREATE TRIGGER trg_transfer_table_execute
AFTER INSERT ON transfer_table_commands
BEGIN
  -- 1. Close current open segment for source table
  UPDATE table_time_segments
  SET ended_at = NEW.issued_at, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id AND ended_at IS NULL;

  -- 2. Insert new segment for target table
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
  WHERE ts.order_id = NEW.order_id AND ts.store_id = NEW.store_id;

  -- 3. Update orders table_id and version
  UPDATE orders
  SET table_id = NEW.target_table_id, version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;

  -- 4. Update time_sessions table_id, product_id, pricing
  UPDATE time_sessions
  SET table_id = NEW.target_table_id,
      time_product_id = (SELECT time_product_id FROM service_tables WHERE id = NEW.target_table_id AND store_id = NEW.store_id),
      pricing_snapshot_json = COALESCE(NEW.target_pricing_snapshot_json, pricing_snapshot_json),
      pricing_version = COALESCE(NEW.target_pricing_version, pricing_version),
      updated_at = NEW.issued_at
  WHERE order_id = NEW.order_id AND store_id = NEW.store_id;

  -- 5. Release source table to AVAILABLE
  UPDATE service_tables
  SET status = 'AVAILABLE', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.source_table_id AND store_id = NEW.store_id;

  -- 6. Set target table to OCCUPIED
  UPDATE service_tables
  SET status = 'OCCUPIED', version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.target_table_id AND store_id = NEW.store_id;

  -- 7. Record audit log
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

-- Sync table_time_segments when time session range is adjusted
DROP TRIGGER IF EXISTS trg_update_time_range_execute;
CREATE TRIGGER trg_update_time_range_execute
AFTER INSERT ON update_time_range_commands
BEGIN
  UPDATE time_sessions
  SET started_at = NEW.started_at,
      ended_at = NEW.ended_at,
      status = CASE
        WHEN NEW.ended_at IS NOT NULL THEN 'ENDED'
        WHEN EXISTS (
          SELECT 1 FROM time_pauses tp
          WHERE tp.time_session_id = time_sessions.id AND tp.resumed_at IS NULL
        ) THEN 'PAUSED'
        ELSE 'RUNNING'
      END,
      updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  UPDATE orders
  SET version = version + 1, updated_at = NEW.issued_at
  WHERE store_id = NEW.store_id AND id = NEW.order_id;

  -- Update earliest segment's started_at
  UPDATE table_time_segments
  SET started_at = NEW.started_at, updated_at = NEW.issued_at
  WHERE id = (
    SELECT id FROM table_time_segments
    WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    ORDER BY started_at ASC LIMIT 1
  );

  -- Update latest segment's ended_at (if ended_at is set)
  UPDATE table_time_segments
  SET ended_at = NEW.ended_at, updated_at = NEW.issued_at
  WHERE id = (
    SELECT id FROM table_time_segments
    WHERE store_id = NEW.store_id AND order_id = NEW.order_id
    ORDER BY started_at DESC LIMIT 1
  );

  INSERT INTO audit_logs (
    id, store_id, actor_user_id, actor_session_id, device_id, action,
    entity_type, entity_id, request_id, before_json, after_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.store_id, NEW.actor_user_id,
    NEW.actor_session_id, NEW.device_id, 'TIME_RANGE_UPDATED', 'ORDER', NEW.order_id,
    NEW.request_id,
    json_object(
      'startedAtMs', NEW.previous_started_at,
      'endedAtMs', NEW.previous_ended_at,
      'status', NEW.previous_status,
      'orderVersion', NEW.expected_order_version
    ),
    json_object(
      'startedAtMs', NEW.started_at,
      'endedAtMs', NEW.ended_at,
      'status', CASE WHEN NEW.ended_at IS NULL THEN 'ACTIVE' ELSE 'ENDED' END,
      'orderVersion', NEW.expected_order_version + 1
    ),
    NEW.issued_at
  );
END;
