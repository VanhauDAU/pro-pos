PRAGMA foreign_keys = ON;

-- UNIQUE(store_id, sequence) already owns a covering SQLite autoindex used by
-- store cursor replay. Keep the partial pending/published indexes and remove
-- only the duplicate full index.
DROP INDEX IF EXISTS idx_realtime_events_store_sequence;

PRAGMA optimize;
