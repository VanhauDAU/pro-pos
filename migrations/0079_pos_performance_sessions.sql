PRAGMA foreign_keys = ON;

CREATE TABLE pos_performance_sessions (
  session_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  device_key TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE INDEX idx_pos_performance_device_time
  ON pos_performance_sessions(device_key, received_at DESC);

CREATE TRIGGER trg_pos_performance_rate_limit
BEFORE INSERT ON pos_performance_sessions
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM pos_performance_sessions
    WHERE device_key = NEW.device_key
      AND received_at > NEW.received_at - 3600000
  ) >= 60 THEN RAISE(ABORT, 'POS_PERFORMANCE_RATE_LIMITED') END;
END;
