PRAGMA foreign_keys = ON;

-- Repair duplicate plain lines already present in open dine-in orders.
CREATE TABLE order_item_merge_0031 AS
SELECT
  MIN(oi.id) AS canonical_id,
  oi.store_id,
  oi.order_id,
  oi.product_id,
  oi.variant_id,
  oi.unit_price_snapshot,
  oi.note,
  SUM(oi.quantity_milli) AS total_quantity_milli
FROM order_items oi
JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id AND o.status = 'OPEN'
WHERE oi.product_type <> 'TIME' AND oi.discount_type IS NULL
GROUP BY oi.store_id, oi.order_id, oi.product_id, oi.variant_id,
  oi.unit_price_snapshot, oi.note
HAVING COUNT(*) > 1;

UPDATE order_items
SET quantity_milli = (
      SELECT merge.total_quantity_milli
      FROM order_item_merge_0031 merge
      WHERE merge.canonical_id = order_items.id
    ),
    gross_line_total = CAST((unit_price_snapshot * (
      SELECT merge.total_quantity_milli
      FROM order_item_merge_0031 merge
      WHERE merge.canonical_id = order_items.id
    ) + 500) / 1000 AS INTEGER),
    net_line_total = CAST((unit_price_snapshot * (
      SELECT merge.total_quantity_milli
      FROM order_item_merge_0031 merge
      WHERE merge.canonical_id = order_items.id
    ) + 500) / 1000 AS INTEGER),
    line_total = CAST((unit_price_snapshot * (
      SELECT merge.total_quantity_milli
      FROM order_item_merge_0031 merge
      WHERE merge.canonical_id = order_items.id
    ) + 500) / 1000 AS INTEGER)
WHERE id IN (SELECT canonical_id FROM order_item_merge_0031);

DELETE FROM order_items
WHERE EXISTS (
  SELECT 1
  FROM order_item_merge_0031 merge
  WHERE merge.store_id = order_items.store_id
    AND merge.order_id = order_items.order_id
    AND merge.product_id = order_items.product_id
    AND merge.variant_id IS order_items.variant_id
    AND merge.unit_price_snapshot = order_items.unit_price_snapshot
    AND merge.note IS order_items.note
    AND merge.canonical_id <> order_items.id
);

DROP TABLE order_item_merge_0031;

-- Repair duplicate plain lines already present in open takeaway orders.
CREATE TABLE takeaway_order_item_merge_0031 AS
SELECT
  MIN(oi.id) AS canonical_id,
  oi.store_id,
  oi.order_id,
  oi.product_id,
  oi.variant_id,
  oi.unit_price_snapshot,
  oi.note,
  SUM(oi.quantity_milli) AS total_quantity_milli
FROM takeaway_order_items oi
JOIN takeaway_orders o
  ON o.id = oi.order_id AND o.store_id = oi.store_id AND o.status = 'OPEN'
WHERE oi.product_type <> 'TIME' AND oi.discount_type IS NULL
GROUP BY oi.store_id, oi.order_id, oi.product_id, oi.variant_id,
  oi.unit_price_snapshot, oi.note
HAVING COUNT(*) > 1;

UPDATE takeaway_order_items
SET quantity_milli = (
      SELECT merge.total_quantity_milli
      FROM takeaway_order_item_merge_0031 merge
      WHERE merge.canonical_id = takeaway_order_items.id
    ),
    gross_line_total = CAST((unit_price_snapshot * (
      SELECT merge.total_quantity_milli
      FROM takeaway_order_item_merge_0031 merge
      WHERE merge.canonical_id = takeaway_order_items.id
    ) + 500) / 1000 AS INTEGER),
    net_line_total = CAST((unit_price_snapshot * (
      SELECT merge.total_quantity_milli
      FROM takeaway_order_item_merge_0031 merge
      WHERE merge.canonical_id = takeaway_order_items.id
    ) + 500) / 1000 AS INTEGER)
WHERE id IN (SELECT canonical_id FROM takeaway_order_item_merge_0031);

DELETE FROM takeaway_order_items
WHERE EXISTS (
  SELECT 1
  FROM takeaway_order_item_merge_0031 merge
  WHERE merge.store_id = takeaway_order_items.store_id
    AND merge.order_id = takeaway_order_items.order_id
    AND merge.product_id = takeaway_order_items.product_id
    AND merge.variant_id IS takeaway_order_items.variant_id
    AND merge.unit_price_snapshot = takeaway_order_items.unit_price_snapshot
    AND merge.note IS takeaway_order_items.note
    AND merge.canonical_id <> takeaway_order_items.id
);

DROP TABLE takeaway_order_item_merge_0031;

-- Staff additions reuse a compatible item id selected by PosService.
DROP TRIGGER IF EXISTS trg_add_item_execute;
CREATE TRIGGER trg_add_item_execute
AFTER INSERT ON add_item_commands
BEGIN
  UPDATE order_items
  SET quantity_milli = quantity_milli + NEW.quantity_milli,
      gross_line_total = CAST((unit_price_snapshot * (quantity_milli + NEW.quantity_milli) + 500) / 1000 AS INTEGER),
      net_line_total = CAST((unit_price_snapshot * (quantity_milli + NEW.quantity_milli) + 500) / 1000 AS INTEGER),
      line_total = CAST((unit_price_snapshot * (quantity_milli + NEW.quantity_milli) + 500) / 1000 AS INTEGER),
      updated_at = NEW.issued_at
  WHERE id = NEW.item_id AND store_id = NEW.store_id AND order_id = NEW.order_id
    AND product_id = NEW.product_id AND variant_id IS NEW.variant_id
    AND unit_price_snapshot = NEW.unit_price_snapshot AND note IS NEW.item_note
    AND product_type <> 'TIME' AND discount_type IS NULL AND NEW.discount_type IS NULL;

  INSERT INTO order_items (
    id, store_id, order_id, product_id, variant_id, product_type,
    product_name_snapshot, variant_name_snapshot, unit_name_snapshot,
    unit_price_snapshot, quantity_milli, discount_type, discount_value,
    line_total, discount_input_value, discount_amount, gross_line_total,
    net_line_total, added_by, created_at, updated_at, note,
    time_started_at, time_ended_at
  )
  SELECT
    NEW.item_id, NEW.store_id, NEW.order_id, NEW.product_id, NEW.variant_id,
    NEW.product_type, NEW.product_name_snapshot, NEW.variant_name_snapshot,
    NEW.unit_name_snapshot, NEW.unit_price_snapshot, NEW.quantity_milli,
    NEW.discount_type, NEW.discount_amount, NEW.net_line_total,
    NEW.discount_input_value, NEW.discount_amount, NEW.gross_line_total,
    NEW.net_line_total, NEW.actor_user_id, NEW.issued_at, NEW.issued_at,
    NEW.item_note, NEW.time_started_at, NEW.time_ended_at
  WHERE NOT EXISTS (
    SELECT 1 FROM order_items
    WHERE id = NEW.item_id AND store_id = NEW.store_id AND order_id = NEW.order_id
  );

  UPDATE orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;
END;

DROP TRIGGER IF EXISTS trg_add_takeaway_item_execute;
CREATE TRIGGER trg_add_takeaway_item_execute
AFTER INSERT ON add_takeaway_item_commands
BEGIN
  UPDATE takeaway_order_items
  SET quantity_milli = quantity_milli + NEW.quantity_milli,
      gross_line_total = CAST((unit_price_snapshot * (quantity_milli + NEW.quantity_milli) + 500) / 1000 AS INTEGER),
      net_line_total = CAST((unit_price_snapshot * (quantity_milli + NEW.quantity_milli) + 500) / 1000 AS INTEGER),
      updated_at = NEW.issued_at
  WHERE id = NEW.item_id AND store_id = NEW.store_id AND order_id = NEW.order_id
    AND product_id = NEW.product_id AND variant_id IS NEW.variant_id
    AND unit_price_snapshot = NEW.unit_price_snapshot AND note IS NEW.item_note
    AND product_type <> 'TIME' AND discount_type IS NULL AND NEW.discount_type IS NULL;

  INSERT INTO takeaway_order_items (
    id, store_id, order_id, product_id, variant_id, product_type,
    product_name_snapshot, variant_name_snapshot, unit_name_snapshot,
    unit_price_snapshot, quantity_milli, discount_type, discount_input_value,
    discount_amount, gross_line_total, net_line_total, added_by, created_at,
    updated_at, note
  )
  SELECT
    NEW.item_id, NEW.store_id, NEW.order_id, NEW.product_id, NEW.variant_id,
    NEW.product_type, NEW.product_name_snapshot, NEW.variant_name_snapshot,
    NEW.unit_name_snapshot, NEW.unit_price_snapshot, NEW.quantity_milli,
    NEW.discount_type, NEW.discount_input_value, NEW.discount_amount,
    NEW.gross_line_total, NEW.net_line_total, NEW.actor_user_id,
    NEW.issued_at, NEW.issued_at, NEW.item_note
  WHERE NOT EXISTS (
    SELECT 1 FROM takeaway_order_items
    WHERE id = NEW.item_id AND store_id = NEW.store_id AND order_id = NEW.order_id
  );

  UPDATE takeaway_orders SET version = version + 1, updated_at = NEW.issued_at
  WHERE id = NEW.order_id AND store_id = NEW.store_id;
END;
