PRAGMA foreign_keys = ON;

-- Table-open requests are not attached to an order yet. Publish them through
-- the existing ordered store outbox using the table as the aggregate id.
CREATE TRIGGER trg_table_open_request_realtime_created
AFTER INSERT ON table_open_requests
BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.table_id,
    COALESCE((SELECT version FROM service_tables WHERE id = NEW.table_id), 1),
    NULL, NULL, NEW.id, NEW.id,
    json_array('guest.table-open-requests'),
    json_object(
      'reason', 'TABLE_OPEN_REQUEST_CREATED',
      'tableOpenRequestId', NEW.id,
      'affectedTableIds', json_array(NEW.table_id)
    ),
    NEW.created_at
  );
END;

CREATE TRIGGER trg_table_open_request_realtime_updated
AFTER UPDATE OF status ON table_open_requests
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.table_id,
    COALESCE((SELECT version FROM service_tables WHERE id = NEW.table_id), 1),
    NEW.handled_by, NULL, NEW.id, NEW.id,
    json_array('guest.table-open-requests'),
    json_object(
      'reason', 'TABLE_OPEN_REQUEST_UPDATED',
      'tableOpenRequestId', NEW.id,
      'tableOpenRequestStatus', NEW.status,
      'affectedTableIds', json_array(NEW.table_id)
    ),
    COALESCE(NEW.handled_at, NEW.created_at)
  );
END;
