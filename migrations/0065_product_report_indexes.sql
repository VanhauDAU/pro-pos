PRAGMA foreign_keys = ON;

-- Product reports enter through completed invoices in a time range, then join
-- their frozen line snapshots. These indexes avoid scanning historical lines.
CREATE INDEX IF NOT EXISTS idx_invoice_lines_store_invoice
  ON invoice_lines(store_id, invoice_id);

CREATE INDEX IF NOT EXISTS idx_takeaway_invoices_store_issued
  ON takeaway_invoices(store_id, issued_at);

CREATE INDEX IF NOT EXISTS idx_takeaway_invoice_lines_store_invoice
  ON takeaway_invoice_lines(store_id, invoice_id);
