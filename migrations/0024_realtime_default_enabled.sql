PRAGMA foreign_keys = ON;

-- Realtime is enabled by default for every existing store. An explicit
-- capability row can still be set to 0 later as an operational kill switch.
INSERT OR IGNORE INTO store_capabilities (
  store_id, capability, enabled, updated_by, updated_at
)
SELECT
  id, 'POS_REALTIME', 1, NULL,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM stores;

CREATE TRIGGER trg_store_enable_pos_realtime
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO store_capabilities (
    store_id, capability, enabled, updated_by, updated_at
  ) VALUES (
    NEW.id, 'POS_REALTIME', 1, NULL, NEW.created_at
  );
END;
