-- 0071_print_jobs.sql
-- Operational print jobs queue for mobile remote printing to desktop print bridge

CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  target_device_id TEXT,
  printer_role TEXT NOT NULL DEFAULT 'receipt',
  document_type TEXT NOT NULL,
  document_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'CLAIMED', 'PRINTING', 'COMPLETED', 'FAILED', 'UNCERTAIN', 'CANCELLED')),
  requested_by_user_id TEXT,
  requested_by_device_id TEXT,
  claimed_by_device_id TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  printing_at INTEGER,
  completed_at INTEGER,
  failed_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  failure_code TEXT,
  failure_message TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_print_jobs_store_idempotency
  ON print_jobs(store_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_print_jobs_store_status_created
  ON print_jobs(store_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_print_jobs_target_status
  ON print_jobs(target_device_id, status);
