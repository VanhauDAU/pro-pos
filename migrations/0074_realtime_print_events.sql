PRAGMA foreign_keys = OFF;

DROP TRIGGER trg_realtime_event_request_execute;

CREATE TABLE realtime_events_v2 (
  event_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'pos.order.created',
      'pos.order.changed',
      'pos.order.closed',
      'pos.print_job.created',
      'pos.print_job.updated',
      'pos.print_config.updated'
    )
  ),
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('ORDER', 'PRINT_JOB', 'STORE')),
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version > 0),
  actor_kind TEXT CHECK (actor_kind IN ('OWNER', 'EMPLOYEE') OR actor_kind IS NULL),
  actor_user_id TEXT REFERENCES users(id),
  device_id TEXT REFERENCES devices(id),
  client_mutation_id TEXT,
  request_id TEXT NOT NULL,
  topics_json TEXT NOT NULL CHECK (json_valid(topics_json)),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  occurred_at INTEGER NOT NULL,
  published_at INTEGER,
  publish_attempts INTEGER NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_publish_error TEXT,
  UNIQUE (store_id, sequence)
);

INSERT INTO realtime_events_v2 (
  event_id, store_id, sequence, schema_version, event_type,
  aggregate_type, aggregate_id, aggregate_version,
  actor_kind, actor_user_id, device_id, client_mutation_id, request_id,
  topics_json, data_json, occurred_at, published_at, publish_attempts,
  last_publish_error
)
SELECT
  event_id,
  store_id,
  sequence,
  schema_version,
  CASE
    WHEN published_at IS NULL
      AND (
        json_extract(data_json, '$.reason') LIKE 'PRINT_JOB_%'
        OR EXISTS (SELECT 1 FROM json_each(topics_json) WHERE value = 'pos.print_jobs')
      )
    THEN CASE
      WHEN json_extract(data_json, '$.reason') = 'PRINT_JOB_CREATED'
        THEN 'pos.print_job.created'
      ELSE 'pos.print_job.updated'
    END
    ELSE event_type
  END,
  CASE
    WHEN published_at IS NULL
      AND (
        json_extract(data_json, '$.reason') LIKE 'PRINT_JOB_%'
        OR EXISTS (SELECT 1 FROM json_each(topics_json) WHERE value = 'pos.print_jobs')
      )
    THEN 'PRINT_JOB'
    ELSE aggregate_type
  END,
  CASE
    WHEN published_at IS NULL
      AND (
        json_extract(data_json, '$.reason') LIKE 'PRINT_JOB_%'
        OR EXISTS (SELECT 1 FROM json_each(topics_json) WHERE value = 'pos.print_jobs')
      )
    THEN COALESCE(json_extract(data_json, '$.printJobId'), aggregate_id)
    ELSE aggregate_id
  END,
  aggregate_version,
  actor_kind,
  actor_user_id,
  device_id,
  client_mutation_id,
  request_id,
  topics_json,
  data_json,
  occurred_at,
  published_at,
  publish_attempts,
  last_publish_error
FROM realtime_events;

DROP TABLE realtime_events;
ALTER TABLE realtime_events_v2 RENAME TO realtime_events;

CREATE INDEX idx_realtime_events_store_sequence
  ON realtime_events(store_id, sequence);
CREATE INDEX idx_realtime_events_pending
  ON realtime_events(published_at, occurred_at)
  WHERE published_at IS NULL;
CREATE INDEX idx_realtime_events_published
  ON realtime_events(published_at)
  WHERE published_at IS NOT NULL;
CREATE INDEX idx_realtime_events_store_pending_sequence
  ON realtime_events(store_id, published_at, sequence)
  WHERE published_at IS NULL;

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

PRAGMA foreign_keys = ON;
