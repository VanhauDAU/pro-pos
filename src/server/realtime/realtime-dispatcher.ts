import { RealtimeRepository } from '@server/repositories/realtime-repository';
import { PosService } from '@server/services/pos-service';
import type { RealtimeEventV1 } from '@contracts/realtime';

const PUBLISHED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class RealtimeDispatcher {
  private readonly repository: RealtimeRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new RealtimeRepository(env.DB);
  }

  async dispatchStore(storeId: string) {
    if (!(await this.repository.isEnabled(storeId))) return { published: 0, disabled: true };
    let events = await this.repository.listPendingForStore(storeId);
    if (events.length === 0) return { published: 0, disabled: false };
    if (await this.repository.deltasEnabled(storeId)) {
      events = await this.attachOverviewDeltas(storeId, events);
    }
    const eventIds = events.map((event) => event.eventId);
    const startedAt = Date.now();
    try {
      const room = this.env.STORE_REALTIME.getByName(storeId);
      const result = await room.broadcast(storeId, events);
      await this.repository.markPublished(storeId, eventIds, Date.now());
      console.log(
        JSON.stringify({
          level: 'info',
          message: 'realtime events published',
          storeId,
          eventIds,
          durationMs: Date.now() - startedAt,
          ...result,
        }),
      );
      return { published: events.length, disabled: false };
    } catch (error) {
      const message = errorText(error);
      await this.repository.markPublishFailed(storeId, eventIds, message);
      const room = this.env.STORE_REALTIME.getByName(storeId);
      await room.scheduleRetry(storeId);
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'realtime publish failed',
          storeId,
          eventIds,
          durationMs: Date.now() - startedAt,
          error: message,
        }),
      );
      throw error;
    }
  }

  private async attachOverviewDeltas(storeId: string, events: RealtimeEventV1[]) {
    const service = new PosService(this.env);
    const byOrder = new Map<string, Promise<RealtimeEventV1['data']['overviewDelta']>>();
    const deltaFor = (event: RealtimeEventV1) => {
      let pending = byOrder.get(event.aggregate.id);
      if (!pending) {
        pending = service
          .realtimeOverviewDelta(
            storeId,
            event.aggregate.id,
            event.type === 'pos.order.closed',
            Date.now(),
          )
          .catch(() => undefined);
        byOrder.set(event.aggregate.id, pending);
      }
      return pending;
    };
    return Promise.all(
      events.map(async (event) => {
        if (!event.type.startsWith('pos.order.')) return event;
        const overviewDelta = await deltaFor(event);
        return overviewDelta ? { ...event, data: { ...event.data, overviewDelta } } : event;
      }),
    );
  }

  async dispatchPendingStores() {
    const stores = await this.repository.listPendingStores();
    return Promise.allSettled(stores.map((store) => this.dispatchStore(store.storeId)));
  }

  cleanupPublished(now = Date.now()) {
    return this.repository.cleanupPublished(now - PUBLISHED_RETENTION_MS);
  }
}
