import { describe, expect, it, vi } from 'vitest';

import {
  PaymentSubmissionGuard,
  printIdentityAfterCheckout,
  provisionalPrintIdentity,
} from '../../src/client/lib/print-document-identity';

describe('POS payment/print document identity', () => {
  it('uses the returned invoice id after one checkout for Thanh toán & in', async () => {
    const checkout = vi.fn(async () => ({ invoiceId: 'INV_1', displayCode: 'HD-1' }));
    const createPrintJob = vi.fn(async (_identity: { type: string; id: string }) => undefined);

    const result = await checkout();
    const identity = printIdentityAfterCheckout(result, true);
    if (identity) await createPrintJob(identity);

    expect(checkout).toHaveBeenCalledOnce();
    expect(createPrintJob).toHaveBeenCalledWith({ type: 'invoice', id: 'INV_1' });
    expect(createPrintJob).not.toHaveBeenCalledWith({ type: 'provisional', id: 'ORDER_1' });
  });

  it('does not create a print job for Thanh toán không in', async () => {
    const checkout = vi.fn(async () => ({ invoiceId: 'INV_1' }));
    const createPrintJob = vi.fn();
    const result = await checkout();
    const identity = printIdentityAfterCheckout(result, false);
    if (identity) createPrintJob(identity);
    expect(checkout).toHaveBeenCalledOnce();
    expect(createPrintJob).not.toHaveBeenCalled();
  });

  it('maps In tạm tính to provisional/orderId without checkout', () => {
    const checkout = vi.fn();
    expect(provisionalPrintIdentity('ORDER_1')).toEqual({ type: 'provisional', id: 'ORDER_1' });
    expect(checkout).not.toHaveBeenCalled();
  });

  it('rejects rapid duplicate payment submissions and only unlocks after failure', () => {
    const guard = new PaymentSubmissionGuard();
    expect(guard.tryStart()).toBe(true);
    expect(guard.tryStart()).toBe(false);
    guard.finish(false);
    expect(guard.tryStart()).toBe(true);
    guard.finish(true);
    expect(guard.tryStart()).toBe(false);
  });
});
