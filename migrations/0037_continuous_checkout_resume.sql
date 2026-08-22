PRAGMA foreign_keys = ON;

-- Entering checkout temporarily freezes the quote. If the cashier returns to
-- the order, continue the same table/rate segment so the whole interval is
-- charged continuously and the UI does not show fake table transfers.
DROP TRIGGER IF EXISTS trg_resume_checkout_execute;
CREATE TRIGGER trg_resume_checkout_execute
AFTER INSERT ON resume_checkout_commands
BEGIN
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
      'continuousBilling', 1), NEW.issued_at
  );
END;

-- Repair active orders that were already split by the old resume trigger.
CREATE TABLE segment_merge_groups_0037 AS
WITH ordered AS (
  SELECT
    tts.*,
    LAG(tts.table_id) OVER win AS previous_table_id,
    LAG(tts.time_product_id) OVER win AS previous_time_product_id,
    LAG(tts.pricing_version) OVER win AS previous_pricing_version,
    LAG(tts.pricing_snapshot_json) OVER win AS previous_pricing_snapshot_json,
    LAG(tts.unit_price_snapshot) OVER win AS previous_unit_price_snapshot
  FROM table_time_segments tts
  JOIN orders o ON o.id = tts.order_id AND o.store_id = tts.store_id
    AND o.status IN ('OPEN', 'PAYMENT_PENDING')
  WINDOW win AS (
    PARTITION BY tts.store_id, tts.order_id
    ORDER BY tts.started_at, tts.id
  )
), marked AS (
  SELECT *,
    CASE
      WHEN previous_table_id IS NULL THEN 1
      WHEN table_id <> previous_table_id
        OR time_product_id <> previous_time_product_id
        OR pricing_version <> previous_pricing_version
        OR pricing_snapshot_json <> previous_pricing_snapshot_json
        OR unit_price_snapshot <> previous_unit_price_snapshot
      THEN 1 ELSE 0
    END AS starts_new_group
  FROM ordered
), grouped AS (
  SELECT *,
    SUM(starts_new_group) OVER (
      PARTITION BY store_id, order_id ORDER BY started_at, id
    ) AS group_number
  FROM marked
), ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY store_id, order_id, group_number ORDER BY started_at, id
    ) AS position_in_group
  FROM grouped
)
SELECT
  store_id, order_id, group_number,
  MAX(CASE WHEN position_in_group = 1 THEN id END) AS canonical_id,
  MIN(started_at) AS merged_started_at,
  CASE WHEN SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) > 0
    THEN NULL ELSE MAX(ended_at) END AS merged_ended_at,
  MAX(updated_at) AS merged_updated_at,
  COUNT(*) AS segment_count
FROM ranked
GROUP BY store_id, order_id, group_number;

UPDATE table_time_segments
SET started_at = (
      SELECT merged_started_at FROM segment_merge_groups_0037
      WHERE canonical_id = table_time_segments.id
    ),
    ended_at = (
      SELECT merged_ended_at FROM segment_merge_groups_0037
      WHERE canonical_id = table_time_segments.id
    ),
    updated_at = (
      SELECT merged_updated_at FROM segment_merge_groups_0037
      WHERE canonical_id = table_time_segments.id
    )
WHERE id IN (
  SELECT canonical_id FROM segment_merge_groups_0037 WHERE segment_count > 1
);

DELETE FROM table_time_segments
WHERE EXISTS (
  SELECT 1 FROM segment_merge_groups_0037 groups
  WHERE groups.store_id = table_time_segments.store_id
    AND groups.order_id = table_time_segments.order_id
    AND groups.segment_count > 1
    AND table_time_segments.id <> groups.canonical_id
    AND table_time_segments.started_at >= groups.merged_started_at
    AND (
      groups.merged_ended_at IS NULL
      OR table_time_segments.started_at <= groups.merged_ended_at
    )
    AND table_time_segments.table_id = (
      SELECT canonical.table_id FROM table_time_segments canonical
      WHERE canonical.id = groups.canonical_id
    )
    AND table_time_segments.time_product_id = (
      SELECT canonical.time_product_id FROM table_time_segments canonical
      WHERE canonical.id = groups.canonical_id
    )
    AND table_time_segments.pricing_version = (
      SELECT canonical.pricing_version FROM table_time_segments canonical
      WHERE canonical.id = groups.canonical_id
    )
);

DROP TABLE segment_merge_groups_0037;
