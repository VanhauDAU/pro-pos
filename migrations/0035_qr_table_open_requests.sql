PRAGMA foreign_keys = ON;

CREATE TABLE table_open_requests (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  table_id TEXT NOT NULL REFERENCES service_tables(id),
  qr_code_id TEXT NOT NULL REFERENCES table_qr_codes(id),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  handled_at INTEGER,
  handled_by TEXT REFERENCES users(id),
  cancel_reason TEXT
);

CREATE UNIQUE INDEX uq_open_table_open_request
  ON table_open_requests(store_id, table_id) WHERE status = 'OPEN';
CREATE INDEX idx_table_open_requests_store_status_created
  ON table_open_requests(store_id, status, created_at);
