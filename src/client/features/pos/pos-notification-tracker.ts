import type { PosSoundType } from '@client/lib/sound';
import type {
  GuestOrderRequestDto,
  ServiceRequestDto,
  TableOpenRequestDto,
} from '@contracts/qr-order';

export interface PosNotificationSnapshot {
  guestOrders: GuestOrderRequestDto[];
  serviceRequests: ServiceRequestDto[];
  tableOpenRequests: TableOpenRequestDto[];
}

export type NewPosNotification =
  | {
      kind: 'GUEST_ORDER';
      request: GuestOrderRequestDto;
      sound: PosSoundType;
      dedupeKey: string;
    }
  | {
      kind: 'SERVICE_REQUEST';
      request: ServiceRequestDto;
      sound: PosSoundType;
      dedupeKey: string;
    }
  | {
      kind: 'TABLE_OPEN_REQUEST';
      request: TableOpenRequestDto;
      sound: PosSoundType;
      dedupeKey: string;
    };

/** Keeps polling and realtime snapshots from replaying old notification sounds. */
export class PosNotificationTracker {
  private initialized = false;
  private readonly seenGuestOrderIds = new Set<string>();
  private readonly seenServiceRequestIds = new Set<string>();
  private readonly seenTableOpenRequestIds = new Set<string>();

  observe(snapshot: PosNotificationSnapshot): NewPosNotification[] {
    if (!this.initialized) {
      this.initialized = true;
      this.markAllSeen(snapshot);
      return [];
    }

    const events: NewPosNotification[] = [];
    for (const request of snapshot.guestOrders) {
      if (this.seenGuestOrderIds.has(request.id)) continue;
      this.seenGuestOrderIds.add(request.id);
      if (request.status === 'PENDING') {
        events.push({
          kind: 'GUEST_ORDER',
          request,
          sound: 'NEW_QR_ORDER',
          dedupeKey: `qr-order:${request.id}`,
        });
      }
    }

    for (const request of snapshot.serviceRequests) {
      if (this.seenServiceRequestIds.has(request.id)) continue;
      this.seenServiceRequestIds.add(request.id);
      if (request.status === 'OPEN') {
        events.push({
          kind: 'SERVICE_REQUEST',
          request,
          sound: request.type,
          dedupeKey: `service-req:${request.id}`,
        });
      }
    }

    for (const request of snapshot.tableOpenRequests) {
      if (this.seenTableOpenRequestIds.has(request.id)) continue;
      this.seenTableOpenRequestIds.add(request.id);
      if (request.status === 'OPEN') {
        events.push({
          kind: 'TABLE_OPEN_REQUEST',
          request,
          sound: 'TABLE_OPEN_REQUEST',
          dedupeKey: `table-open:${request.id}`,
        });
      }
    }
    return events;
  }

  private markAllSeen(snapshot: PosNotificationSnapshot): void {
    for (const request of snapshot.guestOrders) this.seenGuestOrderIds.add(request.id);
    for (const request of snapshot.serviceRequests) this.seenServiceRequestIds.add(request.id);
    for (const request of snapshot.tableOpenRequests) {
      this.seenTableOpenRequestIds.add(request.id);
    }
  }
}
