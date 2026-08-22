import type { PosReceiptPrintData } from '@domain/receipt/receipt-generator';

export function buildOwnerPrintPreviewSample(
  receiptType: 'PROVISIONAL' | 'PAYMENT',
  now = Date.now(),
): PosReceiptPrintData {
  const payment = receiptType === 'PAYMENT';
  return {
    receiptType,
    orderCode: payment ? 'HD-260822-000012' : 'D-260822-0012',
    invoiceCode: payment ? 'HD-260822-000012' : null,
    orderType: 'DINE_IN',
    tableName: 'Bàn 01',
    areaName: 'Khu vực 1',
    cashierName: 'Nguyễn Văn A',
    customerName: 'Nguyễn Nhật Quang Minh',
    guestPhone: '0966690040',
    guestAddress: '266 Đội Cấn, Ba Đình, Hà Nội',
    note: 'Ít đá, không lấy ống hút',
    checkInTimeMs: now - 90 * 60_000,
    issuedAtMs: now,
    // Gross 173,000 - manual item discount 10,000 - two promotions 15,000 = 148,000.
    subtotal: 173_000,
    discountTotal: 25_000,
    promotionDiscount: 15_000,
    promotion: {
      name: 'Giảm giá khai trương',
      type: 'FIXED_AMOUNT',
      value: 10_000,
      discountAmountVnd: 10_000,
    },
    promotions: [
      {
        name: 'Giảm giá khai trương',
        type: 'FIXED_AMOUNT',
        value: 10_000,
        discountAmountVnd: 10_000,
      },
      {
        name: 'Ưu đãi khách thân thiết',
        type: 'FIXED_AMOUNT',
        value: 5_000,
        discountAmountVnd: 5_000,
      },
    ],
    total: 148_000,
    ...(payment
      ? {
          paymentMethod: 'CASH' as const,
          cashReceived: 200_000,
          cashChange: 52_000,
          paidAmountVnd: 148_000,
          debtAmountVnd: 0,
          paymentAllocations: [{ method: 'CASH' as const, amountVnd: 148_000 }],
        }
      : {}),
    lines: [
      {
        id: 'preview-time',
        name: 'Tiền giờ',
        quantity: 1,
        unitPrice: 50_000,
        totalPrice: 48_000,
        isTime: true,
        timeStartedAtMs: now - 90 * 60_000,
        timeEndedAtMs: now,
        timeElapsedSeconds: 90 * 60,
      },
      {
        id: 'preview-drink',
        name: 'Trà sữa ô long (size L)',
        quantity: 1,
        unitPrice: 65_000,
        totalPrice: 55_000,
        discountAmount: 10_000,
        discountReason: 'Khách thân thiết',
        unitName: 'Ly',
        note: 'Không lấy ống hút',
      },
      {
        id: 'preview-food',
        name: 'Cơm gà chua ngọt',
        quantity: 1,
        unitPrice: 60_000,
        totalPrice: 60_000,
        unitName: 'Phần',
      },
    ],
  };
}
