import type { PosReceiptPrintData } from '@domain/receipt/receipt-generator';

export const OWNER_PRINT_PREVIEW_TOTAL_VND = 213_000;

export function buildOwnerPrintPreviewSample(
  receiptType: 'PROVISIONAL' | 'PAYMENT',
  now = Date.now(),
): PosReceiptPrintData {
  const payment = receiptType === 'PAYMENT';
  const startMs = now - 150 * 60_000; // 2 hours 30 minutes ago
  const seg1End = startMs + 30 * 60_000;
  const seg2End = seg1End + 60 * 60_000;
  const seg3End = now;

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
    checkInTimeMs: startMs,
    issuedAtMs: now,
    // Gross 245,000 (Time 150,000 + Goods 95,000) - manual item discount 10,000 - two promotions 22,000 = 213,000.
    subtotal: 245_000,
    discountTotal: 32_000,
    promotionDiscount: 22_000,
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
        name: 'Đồng giá trà đào',
        type: 'FLAT_PRICE',
        value: 9_000,
        discountAmountVnd: 12_000,
        flatPriceItems: [
          {
            productName: 'Trà đào',
            variantName: 'Giá mặc định',
            quantityMilli: 2_000,
            originalUnitPriceVnd: 15_000,
            flatUnitPriceVnd: 9_000,
            discountAmountVnd: 12_000,
          },
        ],
      },
    ],
    total: OWNER_PRINT_PREVIEW_TOTAL_VND,
    ...(payment
      ? {
          paymentMethod: 'CASH' as const,
          cashReceived: 300_000,
          cashChange: 87_000,
          paidAmountVnd: 213_000,
          debtAmountVnd: 0,
          paymentAllocations: [{ method: 'CASH' as const, amountVnd: 213_000 }],
        }
      : {}),
    lines: [
      {
        id: 'preview-time',
        name: 'Billiard',
        quantity: 1,
        unitPrice: 60_000,
        totalPrice: 150_000,
        isTime: true,
        timeStartedAtMs: startMs,
        timeEndedAtMs: seg3End,
        timeElapsedSeconds: 150 * 60,
        timeSegments: [
          {
            name: 'Giờ đầu',
            type: 'FIRST_PERIOD',
            startedAtMs: startMs,
            endedAtMs: seg1End,
            elapsedSeconds: 30 * 60,
            priceVnd: 60_000,
            amount: 60_000,
          },
          {
            name: 'Giá thường',
            type: 'BASE',
            startedAtMs: seg1End,
            endedAtMs: seg2End,
            elapsedSeconds: 60 * 60,
            priceVnd: 40_000,
            amount: 40_000,
          },
          {
            name: 'Khung giờ tối',
            type: 'SPECIAL',
            startedAtMs: seg2End,
            endedAtMs: seg3End,
            elapsedSeconds: 60 * 60,
            priceVnd: 50_000,
            amount: 50_000,
          },
        ],
      },
      {
        id: 'preview-drink',
        name: 'Trà sữa ô long',
        priceName: 'Size L',
        priceVariantCount: 2,
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
        name: 'Trà đào',
        priceName: 'Giá chuẩn',
        priceVariantCount: 1,
        quantity: 2,
        unitPrice: 15_000,
        totalPrice: 30_000,
        unitName: 'Ly',
      },
    ],
  };
}
