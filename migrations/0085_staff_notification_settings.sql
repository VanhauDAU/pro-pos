PRAGMA foreign_keys = ON;

CREATE TABLE staff_notification_settings (
  store_id TEXT NOT NULL REFERENCES stores(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  only_active_sessions INTEGER NOT NULL DEFAULT 1 CHECK (only_active_sessions IN (0, 1)),
  notify_order_paid INTEGER NOT NULL DEFAULT 1 CHECK (notify_order_paid IN (0, 1)),
  notify_qr_order INTEGER NOT NULL DEFAULT 1 CHECK (notify_qr_order IN (0, 1)),
  notify_call_staff INTEGER NOT NULL DEFAULT 1 CHECK (notify_call_staff IN (0, 1)),
  notify_checkout_request INTEGER NOT NULL DEFAULT 1 CHECK (notify_checkout_request IN (0, 1)),
  notify_table_open_request INTEGER NOT NULL DEFAULT 1 CHECK (notify_table_open_request IN (0, 1)),
  notify_print_status INTEGER NOT NULL DEFAULT 1 CHECK (notify_print_status IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, user_id)
);

CREATE INDEX idx_staff_notification_settings_store
  ON staff_notification_settings(store_id);
