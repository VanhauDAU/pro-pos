PRAGMA foreign_keys = ON;

CREATE TABLE store_bank_accounts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  bank_bin TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE UNIQUE INDEX uq_store_bank_accounts_active_identity
  ON store_bank_accounts(store_id, bank_bin, account_number)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX uq_store_bank_accounts_default
  ON store_bank_accounts(store_id)
  WHERE status = 'ACTIVE' AND is_default = 1;

CREATE INDEX idx_store_bank_accounts_store_status_default
  ON store_bank_accounts(store_id, status, is_default DESC, created_at);

INSERT INTO store_bank_accounts (
  id, store_id, bank_bin, bank_code, bank_name,
  account_number, account_name, is_default, status,
  created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))), settings.store_id,
  TRIM(settings.bank_name), TRIM(settings.bank_name), TRIM(settings.bank_name),
  TRIM(settings.bank_account_number), COALESCE(TRIM(settings.bank_account_name), ''),
  1, 'ACTIVE', COALESCE(settings.updated_at, store.updated_at),
  COALESCE(settings.updated_at, store.updated_at)
FROM store_settings settings
JOIN stores store ON store.id = settings.store_id
WHERE NULLIF(TRIM(settings.bank_name), '') IS NOT NULL
  AND NULLIF(TRIM(settings.bank_account_number), '') IS NOT NULL;

ALTER TABLE invoice_payment_allocations ADD COLUMN bank_account_id TEXT REFERENCES store_bank_accounts(id);
ALTER TABLE invoice_payment_allocations ADD COLUMN bank_account_snapshot_json TEXT;

CREATE INDEX idx_invoice_payment_allocations_bank_account
  ON invoice_payment_allocations(store_id, bank_account_id)
  WHERE bank_account_id IS NOT NULL;
