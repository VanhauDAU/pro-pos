CREATE TABLE store_print_config_versions (
  store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
);

INSERT INTO store_print_config_versions (store_id, version)
SELECT id, 0 FROM stores;

CREATE TABLE print_config_change_requests (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  actor_user_id TEXT,
  device_id TEXT,
  request_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);

CREATE TRIGGER trg_print_config_change_execute
AFTER INSERT ON print_config_change_requests
BEGIN
  INSERT OR IGNORE INTO store_print_config_versions (store_id, version)
  VALUES (NEW.store_id, 0);

  UPDATE store_print_config_versions
  SET version = version + 1
  WHERE store_id = NEW.store_id;

  INSERT INTO realtime_store_sequences (store_id, last_sequence)
  VALUES (NEW.store_id, 1)
  ON CONFLICT (store_id) DO UPDATE SET last_sequence = last_sequence + 1;

  INSERT INTO realtime_events (
    event_id, store_id, sequence, schema_version, event_type,
    aggregate_type, aggregate_id, aggregate_version,
    actor_kind, actor_user_id, device_id, client_mutation_id, request_id,
    topics_json, data_json, occurred_at
  ) VALUES (
    NEW.id,
    NEW.store_id,
    (SELECT last_sequence FROM realtime_store_sequences WHERE store_id = NEW.store_id),
    1,
    'pos.print_config.updated',
    'STORE',
    NEW.store_id,
    (SELECT version FROM store_print_config_versions WHERE store_id = NEW.store_id),
    CASE
      WHEN NEW.actor_user_id IS NULL THEN NULL
      WHEN EXISTS (SELECT 1 FROM pin_verifiers WHERE user_id = NEW.actor_user_id)
        THEN 'EMPLOYEE'
      WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_user_id)
        THEN 'OWNER'
      ELSE NULL
    END,
    (SELECT id FROM users WHERE id = NEW.actor_user_id),
    (SELECT id FROM devices WHERE id = NEW.device_id),
    NULL,
    NEW.request_id,
    json_array('pos.print_config'),
    json_object(
      'reason', 'PRINT_CONFIG_UPDATED',
      'configVersion',
      (SELECT version FROM store_print_config_versions WHERE store_id = NEW.store_id)
    ),
    NEW.occurred_at
  );

  DELETE FROM print_config_change_requests WHERE id = NEW.id;
END;
