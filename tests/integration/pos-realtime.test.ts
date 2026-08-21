import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import type { RealtimeEventV1 } from '@contracts/realtime';
import { RealtimeRepository } from '@server/repositories/realtime-repository';
import { StoreRealtimeRoom } from '@server/realtime/store-realtime-room';

let storeId = '';
let userId = '';

beforeEach(async () => {
  storeId = crypto.randomUUID();
  userId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO stores (id, name, status, timezone, created_at, updated_at)
       VALUES (?, 'Realtime Store', 'ACTIVE', 'Asia/Ho_Chi_Minh', ?, ?)`,
    ).bind(storeId, now, now),
    env.DB.prepare(
      `INSERT INTO users (
        id, username, display_name, status, must_change_password, created_at, updated_at
      ) VALUES (?, ?, 'Realtime Owner', 'ACTIVE', 0, ?, ?)`,
    ).bind(userId, `realtime-${userId}`, now, now),
  ]);
});

async function createTakeaway(commandId: string, orderId: string, now: number) {
  await env.DB.prepare(
    `INSERT INTO create_takeaway_order_commands (
      id, store_id, order_id, display_code, note, actor_user_id,
      request_id, issued_at, business_day
    ) VALUES (?, ?, ?, '', NULL, ?, ?, ?, '20260821')`,
  )
    .bind(commandId, storeId, orderId, userId, `request-${commandId}`, now)
    .run();
}

describe('POS realtime outbox', () => {
  it('enables realtime by default and emits ordered events', async () => {
    const repository = new RealtimeRepository(env.DB);
    const now = Date.now();
    expect(await repository.isEnabled(storeId)).toBe(true);
    const orderId = '20000000-0000-4000-8000-000000000002';
    await createTakeaway('command-create', orderId, now);
    await env.DB.prepare(
      `INSERT INTO update_order_note_commands (
        id, store_id, order_type, order_id, expected_order_version, note,
        actor_user_id, request_id, issued_at
      ) VALUES ('command-note', ?, 'TAKEAWAY', ?, 1, 'updated', ?, 'request-note', ?)`,
    )
      .bind(storeId, orderId, userId, now + 1)
      .run();

    const sync = await repository.sync(storeId, 0);
    expect(sync.mode).toBe('REPLAY');
    if (sync.mode !== 'REPLAY') return;
    expect(sync.events.map((event) => [event.sequence, event.type, event.data.reason])).toEqual([
      [1, 'pos.order.created', 'CREATED'],
      [2, 'pos.order.changed', 'NOTE_UPDATED'],
    ]);
    expect(sync.events[1]).toMatchObject({
      aggregate: { id: orderId, version: 2 },
      clientMutationId: 'command-note',
    });

    await expect(
      env.DB.prepare(
        `INSERT INTO update_order_note_commands (
          id, store_id, order_type, order_id, expected_order_version, note,
          actor_user_id, request_id, issued_at
        ) VALUES ('command-conflict', ?, 'TAKEAWAY', ?, 1, 'stale', ?, 'request-conflict', ?)`,
      )
        .bind(storeId, orderId, userId, now + 2)
        .run(),
    ).rejects.toThrow('ORDER_VERSION_CONFLICT');
    const afterConflict = await repository.sync(storeId, 0);
    expect(afterConflict).toMatchObject({ mode: 'REPLAY', toSequence: 2 });
  });

  it('supports explicitly disabling realtime as a kill switch', async () => {
    const repository = new RealtimeRepository(env.DB);
    await env.DB.prepare(
      `UPDATE store_capabilities SET enabled = 0, updated_at = ?
       WHERE store_id = ? AND capability = 'POS_REALTIME'`,
    )
      .bind(Date.now(), storeId)
      .run();
    expect(await repository.isEnabled(storeId)).toBe(false);
    await createTakeaway('command-disabled', '20000000-0000-4000-8000-000000000001', Date.now());
    expect(await repository.sync(storeId, 0)).toMatchObject({ mode: 'REPLAY', toSequence: 0 });
  });

  it('requests full sync for a cursor ahead of the store sequence', async () => {
    const repository = new RealtimeRepository(env.DB);
    await createTakeaway('command-cursor', '20000000-0000-4000-8000-000000000003', Date.now());
    await expect(repository.sync(storeId, 99)).resolves.toMatchObject({
      mode: 'FULL_SYNC',
      reason: 'CURSOR_AHEAD',
      cursor: 1,
    });
  });

  it('requests full sync when retained events no longer cover the cursor', async () => {
    const repository = new RealtimeRepository(env.DB);
    await createTakeaway('command-expired', '20000000-0000-4000-8000-000000000004', Date.now());
    await env.DB.prepare('DELETE FROM realtime_events WHERE store_id = ?').bind(storeId).run();
    await expect(repository.sync(storeId, 0)).resolves.toMatchObject({
      mode: 'FULL_SYNC',
      reason: 'CURSOR_EXPIRED',
      cursor: 1,
    });
  });
});

describe('StoreRealtimeRoom', () => {
  it('isolates room identity and deduplicates event delivery', async () => {
    const room = env.STORE_REALTIME.getByName(storeId);
    const event: RealtimeEventV1 = {
      schemaVersion: 1,
      eventId: 'event-1',
      sequence: 1,
      type: 'pos.order.created',
      storeId,
      aggregate: { type: 'ORDER', id: 'order-1', version: 1 },
      occurredAtMs: Date.now(),
      actor: { kind: 'OWNER', id: userId },
      deviceId: null,
      clientMutationId: 'command-1',
      topics: ['pos.orders', 'pos.order:order-1'],
      data: { reason: 'CREATED' },
    };

    await expect(room.broadcast(storeId, [event])).resolves.toMatchObject({ newEvents: 1 });
    await expect(room.broadcast(storeId, [event])).resolves.toMatchObject({ newEvents: 0 });
    await runInDurableObject(room, async (instance, state) => {
      expect(instance).toBeInstanceOf(StoreRealtimeRoom);
      const count = state.storage.sql
        .exec<{ count: number }>('SELECT COUNT(*) AS count FROM delivered_events')
        .one().count;
      expect(count).toBe(1);
    });
  });

  it('accepts a hibernatable socket and broadcasts a read-only event frame', async () => {
    const room = env.STORE_REALTIME.getByName(storeId);
    const response = await room.fetch(
      new Request('https://internal/realtime', {
        headers: {
          Upgrade: 'websocket',
          'Sec-WebSocket-Protocol': 'propos.realtime.v1',
          'X-Propos-Realtime-Store': storeId,
          'X-Propos-Realtime-User': userId,
          'X-Propos-Realtime-Session': 'session-1',
          'X-Propos-Realtime-Connection': 'connection-1',
          'X-Propos-Realtime-Reauth-At': String(Date.now() + 60_000),
        },
      }),
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    const nextMessage = () =>
      new Promise<string>((resolve) => {
        socket.addEventListener('message', (message) => resolve(String(message.data)), {
          once: true,
        });
      });
    const ready = JSON.parse(await nextMessage()) as { type: string };
    expect(ready.type).toBe('ready');

    const event: RealtimeEventV1 = {
      schemaVersion: 1,
      eventId: 'event-socket',
      sequence: 1,
      type: 'pos.order.changed',
      storeId,
      aggregate: { type: 'ORDER', id: 'order-socket', version: 2 },
      occurredAtMs: Date.now(),
      actor: null,
      deviceId: null,
      clientMutationId: null,
      topics: ['pos.orders', 'pos.order:order-socket'],
      data: { reason: 'ITEM_UPDATED' },
    };
    const broadcastMessage = nextMessage();
    await room.broadcast(storeId, [event]);
    const frame = JSON.parse(await broadcastMessage) as { type: string; events: RealtimeEventV1[] };
    expect(frame.type).toBe('events');
    expect(frame.events[0]?.eventId).toBe(event.eventId);
    socket.close(1000, 'test complete');
  });
});
