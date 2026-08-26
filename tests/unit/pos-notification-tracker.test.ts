import { describe, expect, it } from 'vitest';

import { PosNotificationTracker } from '@client/features/pos/pos-notification-tracker';
import type {
  GuestOrderRequestDto,
  ServiceRequestDto,
  TableOpenRequestDto,
} from '@contracts/qr-order';

function guestOrder(id: string, status: GuestOrderRequestDto['status'] = 'PENDING') {
  return { id, status } as GuestOrderRequestDto;
}

function serviceRequest(
  id: string,
  type: ServiceRequestDto['type'] = 'CALL_STAFF',
  status: ServiceRequestDto['status'] = 'OPEN',
) {
  return { id, type, status } as ServiceRequestDto;
}

function tableOpenRequest(id: string) {
  return { id, status: 'OPEN' } as TableOpenRequestDto;
}

describe('POS notification tracker', () => {
  it('marks the initial snapshot as seen without emitting old requests', () => {
    const tracker = new PosNotificationTracker();
    const snapshot = {
      guestOrders: [guestOrder('old-order')],
      serviceRequests: [serviceRequest('old-service')],
      tableOpenRequests: [tableOpenRequest('old-table-open')],
    };

    expect(tracker.observe(snapshot)).toEqual([]);
    expect(tracker.observe(snapshot)).toEqual([]);
  });

  it('emits only genuinely new requests and deduplicates polling/realtime delivery', () => {
    const tracker = new PosNotificationTracker();
    tracker.observe({ guestOrders: [], serviceRequests: [], tableOpenRequests: [] });
    const snapshot = {
      guestOrders: [guestOrder('new-order')],
      serviceRequests: [serviceRequest('new-checkout', 'CHECKOUT_REQUEST')],
      tableOpenRequests: [tableOpenRequest('new-table-open')],
    };

    expect(tracker.observe(snapshot).map(({ sound, dedupeKey }) => ({ sound, dedupeKey }))).toEqual(
      [
        { sound: 'NEW_QR_ORDER', dedupeKey: 'qr-order:new-order' },
        { sound: 'CHECKOUT_REQUEST', dedupeKey: 'service-req:new-checkout' },
        { sound: 'TABLE_OPEN_REQUEST', dedupeKey: 'table-open:new-table-open' },
      ],
    );
    expect(tracker.observe(snapshot)).toEqual([]);
  });

  it('does not replay an ID that first appeared in a non-notifiable status', () => {
    const tracker = new PosNotificationTracker();
    tracker.observe({ guestOrders: [], serviceRequests: [], tableOpenRequests: [] });

    expect(
      tracker.observe({
        guestOrders: [guestOrder('resolved-order', 'ACCEPTED')],
        serviceRequests: [],
        tableOpenRequests: [],
      }),
    ).toEqual([]);
    expect(
      tracker.observe({
        guestOrders: [guestOrder('resolved-order', 'PENDING')],
        serviceRequests: [],
        tableOpenRequests: [],
      }),
    ).toEqual([]);
  });
});
