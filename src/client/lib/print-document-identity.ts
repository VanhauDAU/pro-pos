import type { PrintJobDocumentType } from '@contracts/print-job';

export interface PrintDocumentIdentity {
  type: PrintJobDocumentType;
  id: string;
}

export function invoicePrintIdentity(invoiceId: string): PrintDocumentIdentity {
  if (!invoiceId.trim()) throw new Error('Thiếu invoiceId để in hóa đơn thanh toán.');
  return { type: 'invoice', id: invoiceId };
}

export function provisionalPrintIdentity(orderId: string): PrintDocumentIdentity {
  if (!orderId.trim()) throw new Error('Thiếu orderId để in hóa đơn tạm tính.');
  return { type: 'provisional', id: orderId };
}

export function printIdentityAfterCheckout(
  result: { invoiceId: string },
  shouldPrint: boolean,
): PrintDocumentIdentity | null {
  return shouldPrint ? invoicePrintIdentity(result.invoiceId) : null;
}

/** Synchronous guard for touch double-taps; a successful checkout stays locked permanently. */
export class PaymentSubmissionGuard {
  private locked = false;

  tryStart(): boolean {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }

  finish(paymentCompleted: boolean): void {
    if (!paymentCompleted) this.locked = false;
  }
}
