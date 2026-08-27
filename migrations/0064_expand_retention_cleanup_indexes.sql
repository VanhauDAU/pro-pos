PRAGMA foreign_keys = ON;

-- Global scheduled cleanup runs across every store, so store-prefixed indexes
-- cannot serve these retention predicates efficiently.
CREATE INDEX IF NOT EXISTS idx_guest_order_requests_cleanup
  ON guest_order_requests(status, created_at);

CREATE INDEX IF NOT EXISTS idx_service_requests_cleanup
  ON service_requests(status, created_at);

CREATE INDEX IF NOT EXISTS idx_table_open_requests_cleanup
  ON table_open_requests(status, created_at);

CREATE INDEX IF NOT EXISTS idx_payment_snapshots_cleanup
  ON payment_snapshots(status, created_at);

CREATE INDEX IF NOT EXISTS idx_order_call_batches_cleanup
  ON order_call_batches(created_at, order_type);

CREATE INDEX IF NOT EXISTS idx_realtime_batch_contexts_cleanup
  ON realtime_batch_contexts(created_at);

CREATE INDEX IF NOT EXISTS idx_pos_save_commands_cleanup
  ON pos_save_commands(created_at);

CREATE INDEX IF NOT EXISTS idx_catalog_import_commands_cleanup
  ON catalog_import_commands(created_at);
