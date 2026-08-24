import { DurableObject } from 'cloudflare:workers';

import {
  REALTIME_SCHEMA_VERSION,
  REALTIME_SUBPROTOCOL,
  type RealtimeEventV1,
  type RealtimeServerFrame,
} from '@contracts/realtime';
import { RealtimeRepository } from '@server/repositories/realtime-repository';

export interface RealtimeConnectionAttachment {
  connectionId: string;
  storeId: string;
  userId: string;
  sessionId: string;
  deviceId: string | null;
  connectedAt: number;
  reauthAt: number;
  clientVersion: string;
}

function tag(kind: 'user' | 'session' | 'device', id: string) {
  return `${kind}:${id}`;
}

export class StoreRealtimeRoom extends DurableObject<CloudflareBindings> {
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'),
    );
  }

  private migrate() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_identity (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        store_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS delivered_events (
        event_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        delivered_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_delivered_events_time
        ON delivered_events(delivered_at);
      CREATE TABLE IF NOT EXISTS retry_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        attempts INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO retry_state (singleton, attempts) VALUES (1, 0);
      INSERT OR IGNORE INTO _sql_schema_migrations (id, applied_at)
        VALUES (1, unixepoch('subsec') * 1000);
    `);
  }

  private ensureStore(storeId: string) {
    const identity = this.ctx.storage.sql
      .exec<{ store_id: string }>('SELECT store_id FROM room_identity WHERE singleton = 1')
      .toArray()[0];
    if (!identity) {
      this.ctx.storage.sql.exec(
        'INSERT INTO room_identity (singleton, store_id) VALUES (1, ?)',
        storeId,
      );
      return;
    }
    if (identity.store_id !== storeId) throw new Error('REALTIME_STORE_MISMATCH');
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const storeId = request.headers.get('X-Propos-Realtime-Store');
    const userId = request.headers.get('X-Propos-Realtime-User');
    const sessionId = request.headers.get('X-Propos-Realtime-Session');
    const connectionId = request.headers.get('X-Propos-Realtime-Connection');
    const reauthAt = Number(request.headers.get('X-Propos-Realtime-Reauth-At'));
    if (!storeId || !userId || !sessionId || !connectionId || !Number.isFinite(reauthAt)) {
      return new Response('Missing trusted realtime context', { status: 401 });
    }
    this.ensureStore(storeId);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const deviceId = request.headers.get('X-Propos-Realtime-Device');
    const attachment: RealtimeConnectionAttachment = {
      connectionId,
      storeId,
      userId,
      sessionId,
      deviceId,
      connectedAt: Date.now(),
      reauthAt,
      clientVersion: request.headers.get('X-Propos-Realtime-Client-Version') ?? 'unknown',
    };
    const tags = [tag('user', userId), tag('session', sessionId)];
    if (deviceId) tags.push(tag('device', deviceId));
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment(attachment);
    const rawAfter = new URL(request.url).searchParams.get('after');
    const parsedAfter = rawAfter === null ? null : Number(rawAfter);
    const after =
      parsedAfter !== null && Number.isSafeInteger(parsedAfter) && parsedAfter >= 0
        ? parsedAfter
        : null;
    const sync = await new RealtimeRepository(this.env.DB).sync(storeId, after);
    const ready: RealtimeServerFrame = {
      type: 'ready',
      connectionId,
      serverNowMs: Date.now(),
      reauthAtMs: reauthAt,
      schemaVersion: REALTIME_SCHEMA_VERSION,
      sync,
    };
    server.send(JSON.stringify(ready));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': REALTIME_SUBPROTOCOL },
    });
  }

  async broadcast(storeId: string, events: RealtimeEventV1[]) {
    this.ensureStore(storeId);
    const now = Date.now();
    const fresh: RealtimeEventV1[] = [];
    for (const event of events.toSorted((a, b) => a.sequence - b.sequence)) {
      if (event.storeId !== storeId) throw new Error('REALTIME_EVENT_STORE_MISMATCH');
      const inserted = this.ctx.storage.sql
        .exec<{ event_id: string }>(
          `INSERT OR IGNORE INTO delivered_events (event_id, sequence, delivered_at)
         VALUES (?, ?, ?) RETURNING event_id`,
          event.eventId,
          event.sequence,
          now,
        )
        .toArray()[0];
      if (!inserted) continue;
      fresh.push(event);
    }

    let deliveredConnections = 0;
    if (fresh.length > 0) {
      const frame: RealtimeServerFrame = { type: 'events', events: fresh };
      const payload = JSON.stringify(frame);
      for (const ws of this.ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as RealtimeConnectionAttachment | null;
        if (!attachment || attachment.storeId !== storeId || attachment.reauthAt <= now) {
          ws.close(4401, 'Realtime authentication expired');
          continue;
        }
        try {
          ws.send(payload);
          deliveredConnections += 1;
        } catch {
          ws.close(1011, 'Realtime delivery failed');
        }
      }
    }

    return { acceptedEvents: events.length, newEvents: fresh.length, deliveredConnections };
  }

  async scheduleRetry(storeId: string) {
    this.ensureStore(storeId);
    const current = await this.ctx.storage.getAlarm();
    const dueAt = Date.now() + 5_000;
    if (current === null || current > dueAt) await this.ctx.storage.setAlarm(dueAt);
  }

  async alarm() {
    const identity = this.ctx.storage.sql
      .exec<{ store_id: string }>('SELECT store_id FROM room_identity WHERE singleton = 1')
      .toArray()[0];
    if (!identity) return;
    const repository = new RealtimeRepository(this.env.DB);
    try {
      const events = await repository.listPendingForStore(identity.store_id);
      if (events.length > 0) {
        await this.broadcast(identity.store_id, events);
        await repository.markPublished(
          identity.store_id,
          events.map((event) => event.eventId),
          Date.now(),
        );
      }
      this.ctx.storage.sql.exec('UPDATE retry_state SET attempts = 0 WHERE singleton = 1');
      this.ctx.storage.sql.exec(
        'DELETE FROM delivered_events WHERE delivered_at < ?',
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      );
    } catch (error) {
      const state = this.ctx.storage.sql
        .exec<{ attempts: number }>(
          `UPDATE retry_state SET attempts = attempts + 1 WHERE singleton = 1
           RETURNING attempts`,
        )
        .one();
      const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(state.attempts, 6));
      await this.ctx.storage.setAlarm(Date.now() + delayMs);
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'realtime alarm retry failed',
          storeId: identity.store_id,
          attempts: state.attempts,
          retryInMs: delayMs,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async disconnectSession(storeId: string, sessionId: string) {
    this.ensureStore(storeId);
    let closed = 0;
    for (const ws of this.ctx.getWebSockets(tag('session', sessionId))) {
      ws.close(4401, 'Session revoked');
      closed += 1;
    }
    return closed;
  }

  async disconnectDevice(storeId: string, deviceId: string) {
    this.ensureStore(storeId);
    let closed = 0;
    for (const ws of this.ctx.getWebSockets(tag('device', deviceId))) {
      ws.close(4401, 'Device revoked');
      closed += 1;
    }
    return closed;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === 'string' && message === '{"type":"ping"}') {
      ws.send('{"type":"pong"}');
      return;
    }
    const frame: RealtimeServerFrame = {
      type: 'error',
      code: 'REALTIME_READ_ONLY',
      message: 'WebSocket chỉ dùng để nhận thông báo. Nghiệp vụ phải gọi HTTP API.',
    };
    ws.send(JSON.stringify(frame));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket) {
    ws.close(1011, 'Realtime socket error');
  }
}
