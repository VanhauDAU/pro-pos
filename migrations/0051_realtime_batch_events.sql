PRAGMA foreign_keys = ON;

CREATE TABLE realtime_batch_contexts (
  store_id TEXT NOT NULL REFERENCES stores(id),
  command_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, command_id)
);

-- Missing capability rows follow the runtime invariant: enabled unless explicitly disabled.
DROP TRIGGER trg_realtime_event_request_execute;
CREATE TRIGGER trg_realtime_event_request_execute
AFTER INSERT ON realtime_event_requests
BEGIN
  INSERT OR IGNORE INTO realtime_store_sequences (store_id, last_sequence)
  SELECT NEW.store_id, 0
  WHERE NOT EXISTS (
    SELECT 1 FROM store_capabilities
    WHERE store_id = NEW.store_id AND capability = 'POS_REALTIME' AND enabled = 0
  );

  UPDATE realtime_store_sequences
  SET last_sequence = last_sequence + 1
  WHERE store_id = NEW.store_id AND NOT EXISTS (
    SELECT 1 FROM store_capabilities
    WHERE store_id = NEW.store_id AND capability = 'POS_REALTIME' AND enabled = 0
  );

  INSERT INTO realtime_events (
    event_id, store_id, sequence, schema_version, event_type,
    aggregate_type, aggregate_id, aggregate_version,
    actor_kind, actor_user_id, device_id, client_mutation_id, request_id,
    topics_json, data_json, occurred_at
  )
  SELECT
    NEW.id, NEW.store_id, sequence.last_sequence, 1, NEW.event_type,
    'ORDER', NEW.order_id, NEW.order_version,
    CASE
      WHEN NEW.actor_user_id IS NULL THEN NULL
      WHEN EXISTS (SELECT 1 FROM pin_verifiers WHERE user_id = NEW.actor_user_id)
        THEN 'EMPLOYEE'
      ELSE 'OWNER'
    END,
    NEW.actor_user_id, NEW.device_id, NEW.client_mutation_id, NEW.request_id,
    NEW.topics_json, NEW.data_json, NEW.occurred_at
  FROM realtime_store_sequences sequence
  WHERE sequence.store_id = NEW.store_id
    AND NOT EXISTS (
      SELECT 1 FROM store_capabilities
      WHERE store_id = NEW.store_id AND capability = 'POS_REALTIME' AND enabled = 0
    );

  DELETE FROM realtime_event_requests WHERE id = NEW.id;
END;

DROP TRIGGER trg_rt_create_takeaway;
CREATE TRIGGER trg_rt_create_takeaway
AFTER INSERT ON create_takeaway_order_commands
WHEN NOT EXISTS (
  SELECT 1 FROM realtime_batch_contexts context
  WHERE context.store_id = NEW.store_id
    AND substr(NEW.id, 1, length(context.command_id) + 1) = context.command_id || ':'
)
BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.created', NEW.order_id, 1,
    NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'CREATED'), NEW.issued_at
  );
END;

DROP TRIGGER trg_rt_open_table;
CREATE TRIGGER trg_rt_open_table
AFTER INSERT ON open_table_commands
WHEN NOT EXISTS (
  SELECT 1 FROM realtime_batch_contexts context
  WHERE context.store_id = NEW.store_id
    AND substr(NEW.id, 1, length(context.command_id) + 1) = context.command_id || ':'
)
BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.created', NEW.order_id, 1,
    NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.tables', 'pos.order:' || NEW.order_id),
    json_object('reason', 'CREATED', 'affectedTableIds', json_array(NEW.table_id)), NEW.issued_at
  );
END;

DROP TRIGGER trg_rt_add_item;
CREATE TRIGGER trg_rt_add_item
AFTER INSERT ON add_item_commands
WHEN NOT EXISTS (
  SELECT 1 FROM realtime_batch_contexts context
  WHERE context.store_id = NEW.store_id
    AND substr(NEW.id, 1, length(context.command_id) + 1) = context.command_id || ':'
)
BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'ITEM_ADDED'), NEW.issued_at
  );
END;

DROP TRIGGER trg_rt_add_takeaway_item;
CREATE TRIGGER trg_rt_add_takeaway_item
AFTER INSERT ON add_takeaway_item_commands
WHEN NOT EXISTS (
  SELECT 1 FROM realtime_batch_contexts context
  WHERE context.store_id = NEW.store_id
    AND substr(NEW.id, 1, length(context.command_id) + 1) = context.command_id || ':'
)
BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'ITEM_ADDED'), NEW.issued_at
  );
END;

DROP TRIGGER trg_rt_update_item;
CREATE TRIGGER trg_rt_update_item
AFTER INSERT ON update_order_item_commands
WHEN NOT EXISTS (
  SELECT 1 FROM realtime_batch_contexts context
  WHERE context.store_id = NEW.store_id
    AND substr(NEW.id, 1, length(context.command_id) + 1) = context.command_id || ':'
)
BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'ITEM_UPDATED'), NEW.issued_at
  );
END;

DROP TRIGGER trg_rt_update_note;
CREATE TRIGGER trg_rt_update_note
AFTER INSERT ON update_order_note_commands
WHEN NOT EXISTS (
  SELECT 1 FROM realtime_batch_contexts context
  WHERE context.store_id = NEW.store_id
    AND substr(NEW.id, 1, length(context.command_id) + 1) = context.command_id || ':'
)
BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'NOTE_UPDATED'), NEW.issued_at
  );
END;

DROP TRIGGER trg_rt_update_guest;
CREATE TRIGGER trg_rt_update_guest
AFTER INSERT ON update_order_guest_commands
WHEN NOT EXISTS (
  SELECT 1 FROM realtime_batch_contexts context
  WHERE context.store_id = NEW.store_id
    AND substr(NEW.id, 1, length(context.command_id) + 1) = context.command_id || ':'
)
BEGIN
  INSERT INTO realtime_event_requests VALUES (
    lower(hex(randomblob(16))), NEW.store_id, 'pos.order.changed', NEW.order_id,
    NEW.expected_order_version + 1, NEW.actor_user_id, NULL, NEW.id, NEW.request_id,
    json_array('pos.orders', 'pos.order:' || NEW.order_id),
    json_object('reason', 'GUEST_UPDATED'), NEW.issued_at
  );
END;
