import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  armPaymentReturn,
  clearPaymentPageActive,
  isReturningFromPayment,
  markPaymentNavigationStarted,
} from '@client/features/pos/payment-return-state';
import { canonicalPaymentPath } from '@client/features/pos/payment-navigation';

describe('payment return state', () => {
  const orderId = 'order-payment-race';

  afterEach(() => {
    clearPaymentPageActive(orderId);
    vi.useRealTimers();
  });

  it('does not arm return while entering payment, even after a pending quote arrives', () => {
    markPaymentNavigationStarted(orderId);

    expect(isReturningFromPayment(orderId, 2)).toBe(false);

    // A PAYMENT_PENDING cache update alone must not grant resume permission.
    expect(isReturningFromPayment(orderId, 3)).toBe(false);
  });

  it('arms exactly when the payment page is left with a still-frozen order', () => {
    markPaymentNavigationStarted(orderId);
    armPaymentReturn(orderId, 7);

    expect(isReturningFromPayment(orderId, 7)).toBe(true);
    expect(isReturningFromPayment(orderId, 8)).toBe(false);
  });

  it('clears return permission after resume or successful payment', () => {
    markPaymentNavigationStarted(orderId);
    armPaymentReturn(orderId, 7);
    clearPaymentPageActive(orderId);

    expect(isReturningFromPayment(orderId, 7)).toBe(false);
  });

  it('always builds a canonical URL for a server-created order', () => {
    expect(canonicalPaymentPath('created-order', true)).toBe(
      '/pos/orders/created-order?checkout=1',
    );
    expect(canonicalPaymentPath('created-order', false)).toBe('/pos/orders/created-order/payment');
  });
});
