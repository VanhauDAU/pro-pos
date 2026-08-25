CREATE TABLE catalog_import_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (store_id, idempotency_key)
);

CREATE INDEX idx_catalog_import_commands_store_created
  ON catalog_import_commands(store_id, created_at);
