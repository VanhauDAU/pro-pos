import {
  REALTIME_REPLAY_LIMIT,
  type PosRealtimeTopic,
  type RealtimeEventV1,
  type RealtimeSyncResponse,
} from '@contracts/realtime';

interface RealtimeEventRow {
  eventId: string;
  storeId: string;
  sequence: number;
  schemaVersion: 1;
  eventType: RealtimeEventV1['type'];
  aggregateId: string;
  aggregateVersion: number;
  actorKind: 'OWNER' | 'EMPLOYEE' | null;
  actorUserId: string | null;
  deviceId: string | null;
  clientMutationId: string | null;
  topicsJson: string;
  dataJson: string;
  occurredAtMs: number;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function mapRealtimeEvent(row: RealtimeEventRow): RealtimeEventV1 {
  const data = parseJson<RealtimeEventV1['data']>(row.dataJson, {
    reason: 'ITEM_UPDATED',
  });
  const aggregateType: 'ORDER' | 'PRINT_JOB' | 'STORE' = row.eventType.startsWith('pos.print_job')
    ? 'PRINT_JOB'
    : row.eventType === 'pos.print_config.updated'
      ? 'STORE'
      : 'ORDER';
  return {
    schemaVersion: row.schemaVersion,
    eventId: row.eventId,
    sequence: row.sequence,
    type: row.eventType,
    storeId: row.storeId,
    aggregate: { type: aggregateType, id: row.aggregateId, version: row.aggregateVersion },
    occurredAtMs: row.occurredAtMs,
    actor: row.actorKind && row.actorUserId ? { kind: row.actorKind, id: row.actorUserId } : null,
    deviceId: row.deviceId,
    clientMutationId: row.clientMutationId,
    topics: parseJson<PosRealtimeTopic[]>(row.topicsJson, []),
    data,
  };
}

const EVENT_SELECT = `
  SELECT event_id AS eventId, store_id AS storeId, sequence,
         schema_version AS schemaVersion, event_type AS eventType,
         aggregate_id AS aggregateId, aggregate_version AS aggregateVersion,
         actor_kind AS actorKind, actor_user_id AS actorUserId, device_id AS deviceId,
         client_mutation_id AS clientMutationId, topics_json AS topicsJson,
         data_json AS dataJson, occurred_at AS occurredAtMs
  FROM realtime_events`;

export class RealtimeRepository {
  constructor(private readonly db: D1Database) {}

  async isEnabled(storeId: string) {
    const row = await this.db
      .prepare(
        `SELECT enabled FROM store_capabilities
         WHERE store_id = ? AND capability = 'POS_REALTIME' LIMIT 1`,
      )
      .bind(storeId)
      .first<{ enabled: 0 | 1 }>();
    return row ? row.enabled === 1 : true;
  }

  async deltasEnabled(storeId: string) {
    const row = await this.db
      .prepare(
        `SELECT enabled FROM store_capabilities
         WHERE store_id = ? AND capability = 'POS_REALTIME_DELTAS_V2' LIMIT 1`,
      )
      .bind(storeId)
      .first<{ enabled: 0 | 1 }>();
    return row?.enabled === 1;
  }

  async sync(storeId: string, after: number | null): Promise<RealtimeSyncResponse> {
    const now = Date.now();
    const bounds = await this.db
      .prepare(
        `SELECT
           COALESCE((
             SELECT MIN(sequence) FROM realtime_events WHERE store_id = ?
           ), 0) AS minSequence,
           COALESCE((
             SELECT last_sequence FROM realtime_store_sequences WHERE store_id = ?
           ), 0) AS maxSequence`,
      )
      .bind(storeId, storeId)
      .first<{ minSequence: number; maxSequence: number }>();
    const minSequence = bounds?.minSequence ?? 0;
    const maxSequence = bounds?.maxSequence ?? 0;

    if (after === null) {
      return { mode: 'FULL_SYNC', cursor: maxSequence, serverNowMs: now, reason: 'NO_CURSOR' };
    }
    if (after > maxSequence) {
      return {
        mode: 'FULL_SYNC',
        cursor: maxSequence,
        serverNowMs: now,
        reason: 'CURSOR_AHEAD',
      };
    }
    if (after < maxSequence && (minSequence === 0 || after < minSequence - 1)) {
      return {
        mode: 'FULL_SYNC',
        cursor: maxSequence,
        serverNowMs: now,
        reason: 'CURSOR_EXPIRED',
      };
    }
    if (maxSequence - after > REALTIME_REPLAY_LIMIT) {
      return {
        mode: 'FULL_SYNC',
        cursor: maxSequence,
        serverNowMs: now,
        reason: 'TOO_MANY_EVENTS',
      };
    }

    const result = await this.db
      .prepare(
        `${EVENT_SELECT}
         WHERE store_id = ? AND sequence > ?
         ORDER BY sequence ASC LIMIT ?`,
      )
      .bind(storeId, after, REALTIME_REPLAY_LIMIT)
      .all<RealtimeEventRow>();
    return {
      mode: 'REPLAY',
      fromSequence: after,
      toSequence: maxSequence,
      serverNowMs: now,
      events: result.results.map(mapRealtimeEvent),
    };
  }

  async listPendingForStore(storeId: string, limit = 100) {
    const result = await this.db
      .prepare(
        `${EVENT_SELECT}
         WHERE store_id = ? AND published_at IS NULL
         ORDER BY sequence ASC LIMIT ?`,
      )
      .bind(storeId, limit)
      .all<RealtimeEventRow>();
    return result.results.map(mapRealtimeEvent);
  }

  async listPendingStores(limit = 100) {
    const result = await this.db
      .prepare(
        `SELECT store_id AS storeId, MIN(occurred_at) AS oldestAt
         FROM realtime_events WHERE published_at IS NULL
         GROUP BY store_id ORDER BY oldestAt ASC LIMIT ?`,
      )
      .bind(limit)
      .all<{ storeId: string; oldestAt: number }>();
    return result.results;
  }

  async markPublished(storeId: string, eventIds: string[], now: number) {
    if (eventIds.length === 0) return;
    const placeholders = eventIds.map(() => '?').join(', ');
    await this.db
      .prepare(
        `UPDATE realtime_events
         SET published_at = ?, publish_attempts = publish_attempts + 1,
             last_publish_error = NULL
         WHERE store_id = ? AND event_id IN (${placeholders})`,
      )
      .bind(now, storeId, ...eventIds)
      .run();
  }

  async markPublishFailed(storeId: string, eventIds: string[], error: string) {
    if (eventIds.length === 0) return;
    const placeholders = eventIds.map(() => '?').join(', ');
    await this.db
      .prepare(
        `UPDATE realtime_events
         SET publish_attempts = publish_attempts + 1, last_publish_error = ?
         WHERE store_id = ? AND event_id IN (${placeholders})`,
      )
      .bind(error.slice(0, 500), storeId, ...eventIds)
      .run();
  }

  async cleanupPublished(beforeMs: number) {
    await this.db
      .prepare(`DELETE FROM realtime_events WHERE published_at IS NOT NULL AND published_at < ?`)
      .bind(beforeMs)
      .run();
  }
}
