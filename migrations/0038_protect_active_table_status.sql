PRAGMA foreign_keys = ON;

-- Repair tables released by deletion of an older invoice while a newer order
-- is still active on the same table.
UPDATE service_tables
SET status = 'OCCUPIED', version = version + 1, updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE status = 'AVAILABLE'
  AND EXISTS (
    SELECT 1 FROM orders
    WHERE orders.store_id = service_tables.store_id
      AND orders.table_id = service_tables.id
      AND orders.status IN ('OPEN', 'PAYMENT_PENDING')
  );

CREATE TRIGGER trg_service_table_prevent_release_with_active_order
BEFORE UPDATE OF status ON service_tables
WHEN NEW.status = 'AVAILABLE' AND EXISTS (
  SELECT 1 FROM orders
  WHERE orders.store_id = NEW.store_id
    AND orders.table_id = NEW.id
    AND orders.status IN ('OPEN', 'PAYMENT_PENDING')
)
BEGIN
  SELECT RAISE(ABORT, 'TABLE_HAS_ACTIVE_ORDER');
END;
