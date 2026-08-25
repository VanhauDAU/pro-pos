PRAGMA foreign_keys = ON;

ALTER TABLE guest_order_requests ADD COLUMN customer_name TEXT;
ALTER TABLE service_requests ADD COLUMN customer_name TEXT;
ALTER TABLE table_open_requests ADD COLUMN customer_name TEXT;
