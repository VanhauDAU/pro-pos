PRAGMA foreign_keys = ON;

CREATE TABLE store_settings (
  store_id TEXT PRIMARY KEY REFERENCES stores(id),
  phone TEXT,
  address TEXT,
  currency TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  business_day_cutoff_minutes INTEGER NOT NULL DEFAULT 0 CHECK (
    business_day_cutoff_minutes BETWEEN 0 AND 1439
  ),
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  bank_qr_media_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE areas (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, name COLLATE NOCASE)
);

CREATE TABLE units (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, name COLLATE NOCASE)
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, name COLLATE NOCASE)
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  category_id TEXT REFERENCES categories(id),
  unit_id TEXT REFERENCES units(id),
  name TEXT NOT NULL,
  description TEXT,
  product_type TEXT NOT NULL CHECK (product_type IN ('QUANTITY', 'WEIGHT', 'TIME')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  avatar_type TEXT NOT NULL DEFAULT 'COLOR' CHECK (avatar_type IN ('COLOR', 'IMAGE')),
  avatar_color TEXT,
  media_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  display_code TEXT NOT NULL,
  name TEXT NOT NULL,
  sale_price INTEGER CHECK (sale_price >= 0),
  cost_price INTEGER NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  prompt_price INTEGER NOT NULL DEFAULT 0 CHECK (prompt_price IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, display_code)
);

CREATE TABLE time_price_configs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  base_price INTEGER NOT NULL CHECK (base_price > 0),
  base_duration_seconds INTEGER NOT NULL CHECK (base_duration_seconds > 0),
  calculation_mode TEXT NOT NULL CHECK (calculation_mode IN ('ACTUAL_TIME', 'TIME_BLOCK')),
  rounding_unit INTEGER NOT NULL DEFAULT 1000 CHECK (rounding_unit IN (0, 100, 500, 1000, 5000)),
  first_period_enabled INTEGER NOT NULL DEFAULT 0 CHECK (first_period_enabled IN (0, 1)),
  first_period_duration_seconds INTEGER CHECK (first_period_duration_seconds > 0),
  first_period_price INTEGER CHECK (first_period_price > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, product_id)
);

CREATE TABLE special_price_windows (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  time_price_config_id TEXT NOT NULL REFERENCES time_price_configs(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1439),
  weekdays_mask INTEGER NOT NULL CHECK (weekdays_mask BETWEEN 1 AND 127),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE media_objects (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DELETED')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_products_store_status ON products(store_id, status);
CREATE INDEX idx_variants_product_status ON product_variants(product_id, status);
CREATE INDEX idx_special_windows_config ON special_price_windows(time_price_config_id);
CREATE INDEX idx_media_store_status ON media_objects(store_id, status);
