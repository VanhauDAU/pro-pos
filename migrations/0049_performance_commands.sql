PRAGMA foreign_keys = ON;

CREATE TABLE pos_save_commands (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (store_id, id)
);

CREATE INDEX idx_pos_save_commands_store_created
  ON pos_save_commands(store_id, created_at);

CREATE INDEX idx_time_pauses_store_session_time
  ON time_pauses(store_id, time_session_id, paused_at);

CREATE INDEX idx_table_time_segments_store_order_time
  ON table_time_segments(store_id, order_id, started_at);

CREATE INDEX idx_stop_time_commands_store_order_time
  ON stop_time_commands(store_id, order_id, issued_at);

CREATE INDEX idx_resume_checkout_commands_store_order_time
  ON resume_checkout_commands(store_id, order_id, issued_at);

CREATE INDEX idx_transfer_table_commands_store_order_time
  ON transfer_table_commands(store_id, order_id, issued_at);

CREATE INDEX idx_promotion_targets_store_program_type
  ON promotion_targets(store_id, promotion_id, target_type, target_id, variant_id);

CREATE INDEX idx_promotion_groups_store_program
  ON promotion_customer_groups(store_id, promotion_id, customer_group_id);

CREATE INDEX idx_realtime_events_store_pending_sequence
  ON realtime_events(store_id, published_at, sequence)
  WHERE published_at IS NULL;
