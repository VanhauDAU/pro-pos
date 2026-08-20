PRAGMA foreign_keys = ON;

-- Owner setup tables/rooms can exist before pricing is configured. A hidden
-- TIME product keeps the existing POS foreign-key invariant intact, while the
-- display label is independent from the legacy unique operational name.
ALTER TABLE products ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0
  CHECK (is_system IN (0, 1));

ALTER TABLE service_tables ADD COLUMN display_name TEXT;

CREATE UNIQUE INDEX uq_products_store_system
  ON products(store_id)
  WHERE is_system = 1;

CREATE INDEX idx_tables_area_status_sort
  ON service_tables(area_id, status, sort_order);
