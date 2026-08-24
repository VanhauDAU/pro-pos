PRAGMA foreign_keys = ON;

CREATE TABLE order_call_batches (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  order_id TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  actor_user_id TEXT REFERENCES users(id),
  request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (store_id, order_id, sequence_no),
  UNIQUE (store_id, request_id)
);

CREATE INDEX idx_order_call_batches_order_sequence
  ON order_call_batches(store_id, order_id, sequence_no DESC);

CREATE TABLE order_call_batch_entries (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  batch_id TEXT NOT NULL REFERENCES order_call_batches(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  item_id TEXT,
  change_type TEXT NOT NULL CHECK (change_type IN ('ADD', 'ADJUST', 'EDIT', 'REMOVE')),
  product_id TEXT NOT NULL,
  variant_id TEXT,
  product_type TEXT NOT NULL CHECK (product_type IN ('QUANTITY', 'WEIGHT', 'TIME')),
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT,
  unit_name_snapshot TEXT,
  unit_price_snapshot INTEGER NOT NULL CHECK (unit_price_snapshot >= 0),
  before_quantity_milli INTEGER NOT NULL CHECK (before_quantity_milli >= 0),
  delta_quantity_milli INTEGER NOT NULL,
  after_quantity_milli INTEGER NOT NULL CHECK (after_quantity_milli >= 0),
  before_note TEXT,
  after_note TEXT,
  before_discount_json TEXT,
  after_discount_json TEXT,
  removal_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_order_call_batch_entries_batch
  ON order_call_batch_entries(store_id, batch_id, id);
