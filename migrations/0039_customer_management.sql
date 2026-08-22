PRAGMA foreign_keys = ON;

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  normalized_phone TEXT NOT NULL,
  email TEXT,
  birth_date TEXT,
  gender TEXT CHECK (gender IN ('MALE', 'FEMALE', 'OTHER') OR gender IS NULL),
  province_code INTEGER,
  province_name TEXT,
  ward_code INTEGER,
  ward_name TEXT,
  address_line TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  invoice_count INTEGER NOT NULL DEFAULT 0 CHECK (invoice_count >= 0),
  total_spent_vnd INTEGER NOT NULL DEFAULT 0 CHECK (total_spent_vnd >= 0),
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  debt_balance_vnd INTEGER NOT NULL DEFAULT 0 CHECK (debt_balance_vnd >= 0),
  last_order_at INTEGER,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  UNIQUE (store_id, normalized_phone)
);

CREATE INDEX idx_customers_store_status_name ON customers(store_id, status, name COLLATE NOCASE);
CREATE INDEX idx_customers_store_phone ON customers(store_id, normalized_phone);

CREATE TABLE customer_groups (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  membership_type TEXT NOT NULL CHECK (membership_type IN ('MANUAL', 'AUTOMATIC')),
  rules_json TEXT,
  note TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, name COLLATE NOCASE)
);

CREATE TABLE customer_group_members (
  store_id TEXT NOT NULL REFERENCES stores(id),
  group_id TEXT NOT NULL REFERENCES customer_groups(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, customer_id)
);
CREATE INDEX idx_customer_group_members_customer ON customer_group_members(store_id, customer_id);

CREATE TABLE customer_loyalty_settings (
  store_id TEXT PRIMARY KEY REFERENCES stores(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  vnd_per_point INTEGER NOT NULL DEFAULT 10000 CHECK (vnd_per_point > 0),
  updated_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL
);

CREATE TABLE customer_loyalty_entries (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  invoice_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('EARN', 'REVERSAL', 'ADJUSTMENT')),
  points INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  note TEXT,
  actor_user_id TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE (store_id, invoice_id, entry_type)
);
CREATE INDEX idx_customer_loyalty_entries_customer ON customer_loyalty_entries(store_id, customer_id, created_at DESC);

CREATE TABLE customer_debt_entries (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  invoice_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('CHARGE', 'PAYMENT', 'ADJUSTMENT', 'REVERSAL')),
  amount_vnd INTEGER NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('CASH', 'BANK_TRANSFER') OR payment_method IS NULL),
  reference TEXT,
  note TEXT,
  actor_user_id TEXT REFERENCES users(id),
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (store_id, idempotency_key)
);
CREATE INDEX idx_customer_debt_entries_customer ON customer_debt_entries(store_id, customer_id, created_at DESC);

CREATE TABLE invoice_payment_allocations (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  invoice_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('CASH', 'BANK_TRANSFER', 'DEBT')),
  amount_vnd INTEGER NOT NULL CHECK (amount_vnd >= 0),
  tendered_vnd INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_invoice_payment_allocations_invoice ON invoice_payment_allocations(store_id, invoice_id);

ALTER TABLE orders ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE takeaway_orders ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE invoices ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE takeaway_invoices ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE update_order_guest_commands ADD COLUMN customer_id TEXT REFERENCES customers(id);

DROP TRIGGER trg_update_order_guest_execute;
CREATE TRIGGER trg_update_order_guest_execute
AFTER INSERT ON update_order_guest_commands
BEGIN
  UPDATE orders
  SET guest_count = NEW.guest_count, customer_name = NEW.customer_name,
      customer_phone = NEW.customer_phone, customer_id = NEW.customer_id,
      version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'DINE_IN' AND id = NEW.order_id AND store_id = NEW.store_id;
  UPDATE takeaway_orders
  SET guest_count = NEW.guest_count, customer_name = NEW.customer_name,
      customer_phone = NEW.customer_phone, customer_id = NEW.customer_id,
      version = version + 1, updated_at = NEW.issued_at
  WHERE NEW.order_type = 'TAKEAWAY' AND id = NEW.order_id AND store_id = NEW.store_id;
END;

-- Backfill valid Vietnamese phone numbers from legacy orders. Formatting characters
-- commonly entered by cashiers are removed before de-duplication.
INSERT OR IGNORE INTO customers (
  id, store_id, name, phone, normalized_phone, status, created_at, updated_at
)
SELECT lower(hex(randomblob(16))), store_id,
       COALESCE(MAX(NULLIF(TRIM(customer_name), '')), 'Khách hàng'),
       normalized_phone, normalized_phone, 'ACTIVE', MIN(created_at), MAX(updated_at)
FROM (
  SELECT store_id, customer_name, created_at, updated_at,
    replace(replace(replace(replace(replace(TRIM(customer_phone), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '') AS normalized_phone
  FROM orders WHERE customer_phone IS NOT NULL
  UNION ALL
  SELECT store_id, customer_name, created_at, updated_at,
    replace(replace(replace(replace(replace(TRIM(customer_phone), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '') AS normalized_phone
  FROM takeaway_orders WHERE customer_phone IS NOT NULL
)
WHERE (length(normalized_phone) = 10 AND normalized_phone GLOB '0[35789][0-9]*')
   OR (length(normalized_phone) IN (10, 11) AND normalized_phone GLOB '02[0-9]*')
GROUP BY store_id, normalized_phone;

UPDATE orders SET customer_id = (
  SELECT c.id FROM customers c WHERE c.store_id = orders.store_id
    AND c.normalized_phone = replace(replace(replace(replace(replace(TRIM(orders.customer_phone), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '')
) WHERE customer_phone IS NOT NULL;
UPDATE takeaway_orders SET customer_id = (
  SELECT c.id FROM customers c WHERE c.store_id = takeaway_orders.store_id
    AND c.normalized_phone = replace(replace(replace(replace(replace(TRIM(takeaway_orders.customer_phone), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '')
) WHERE customer_phone IS NOT NULL;
UPDATE invoices SET customer_id = (SELECT o.customer_id FROM orders o WHERE o.id = invoices.order_id);
UPDATE takeaway_invoices SET customer_id = (SELECT o.customer_id FROM takeaway_orders o WHERE o.id = takeaway_invoices.order_id);

UPDATE customers SET
  invoice_count = (
    SELECT COUNT(*) FROM (
      SELECT i.id FROM invoices i WHERE i.store_id = customers.store_id AND i.customer_id = customers.id AND i.status = 'COMPLETED'
      UNION ALL
      SELECT i.id FROM takeaway_invoices i WHERE i.store_id = customers.store_id AND i.customer_id = customers.id AND i.status = 'COMPLETED'
    )
  ),
  total_spent_vnd = COALESCE((SELECT SUM(total) FROM (
    SELECT i.total FROM invoices i WHERE i.store_id = customers.store_id AND i.customer_id = customers.id AND i.status = 'COMPLETED'
    UNION ALL
    SELECT i.total FROM takeaway_invoices i WHERE i.store_id = customers.store_id AND i.customer_id = customers.id AND i.status = 'COMPLETED'
  )), 0),
  last_order_at = (SELECT MAX(issued_at) FROM (
    SELECT i.issued_at FROM invoices i WHERE i.store_id = customers.store_id AND i.customer_id = customers.id AND i.status = 'COMPLETED'
    UNION ALL
    SELECT i.issued_at FROM takeaway_invoices i WHERE i.store_id = customers.store_id AND i.customer_id = customers.id AND i.status = 'COMPLETED'
  ));
