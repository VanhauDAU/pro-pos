PRAGMA foreign_keys = ON;

ALTER TABLE cancel_order_commands ADD COLUMN response_json TEXT;
ALTER TABLE cancel_takeaway_order_commands ADD COLUMN response_json TEXT;
