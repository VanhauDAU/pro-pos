PRAGMA foreign_keys = ON;

-- Keep daily 3-day cleanup cheap without indexing permanent security/catalog
-- audit rows. This partial index remains bounded by the same retention policy.
CREATE INDEX idx_audit_operational_created
  ON audit_logs(created_at)
  WHERE action IN (
    'TABLE_OPENED', 'TAKEAWAY_ORDER_CREATED',
    'ORDER_ITEM_ADDED', 'ORDER_ITEM_ADDED_WITH_DISCOUNT',
    'ORDER_ITEM_UPDATED', 'ORDER_ITEM_REMOVED', 'ORDER_NOTE_UPDATED',
    'TABLE_TRANSFERRED', 'TIME_PAUSED', 'TIME_RESUMED',
    'TIME_RANGE_UPDATED', 'TIME_SESSION_REMOVED', 'TIME_SESSION_RESTORED',
    'ORDER_CHECKOUT_PENDING', 'ORDER_RESUMED_FROM_CHECKOUT',
    'CHECKOUT_COMPLETED', 'ORDER_CANCELLED'
  );
