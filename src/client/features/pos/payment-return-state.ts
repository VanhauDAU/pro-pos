export interface PaymentReturnMarker {
  enteredAt: number;
  pendingVersion: number | null;
  returnArmed: boolean;
}

// Module state is intentionally scoped to one browser tab/runtime. Persisted
// storage can be copied when a tab is duplicated and must not grant another tab
// permission to resume an order it did not leave from checkout.
const activePaymentReturns = new Map<string, PaymentReturnMarker>();

function paymentReturnKey(orderId: string) {
  return `pos-payment-return:${orderId}`;
}

export function markPaymentNavigationStarted(orderId: string) {
  activePaymentReturns.set(paymentReturnKey(orderId), {
    enteredAt: Date.now(),
    pendingVersion: null,
    returnArmed: false,
  });
}

export function armPaymentReturn(orderId: string, pendingVersion: number | null = null) {
  const key = paymentReturnKey(orderId);
  const current = activePaymentReturns.get(key);
  activePaymentReturns.set(key, {
    enteredAt: current?.enteredAt ?? Date.now(),
    pendingVersion,
    returnArmed: true,
  });
}

export function clearPaymentPageActive(orderId: string) {
  activePaymentReturns.delete(paymentReturnKey(orderId));
}

export function isReturningFromPayment(orderId: string, pendingVersion: number) {
  const marker = activePaymentReturns.get(paymentReturnKey(orderId));
  if (!marker?.returnArmed) return false;
  if (marker.pendingVersion !== null) {
    return marker.pendingVersion === pendingVersion;
  }
  return Date.now() - marker.enteredAt < 120_000;
}
