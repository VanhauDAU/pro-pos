PRAGMA foreign_keys = ON;

CREATE TABLE product_report_print_snapshots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  requested_by_user_id TEXT REFERENCES users(id),
  requested_by_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_product_report_print_snapshots_store
  ON product_report_print_snapshots(store_id, created_at DESC);

CREATE INDEX idx_product_report_print_snapshots_expiry
  ON product_report_print_snapshots(expires_at);
