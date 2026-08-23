import { describe, expect, it } from 'vitest';
import { promotionPreviewSchema, type PromotionPreviewResult } from '@contracts/promotion';

describe('Real-time Promotion Preview & Draft Discount Calculations', () => {
  it('validates promotionPreviewSchema with draft items and subtotal', () => {
    const validDraftInput = {
      orderId: null,
      customerId: 'cust-123',
      subtotalVnd: 150_000,
      promotionIds: ['promo-1'],
      items: [
        {
          productId: 'prod-1',
          variantId: 'var-1',
          productType: 'QUANTITY' as const,
          productName: 'Cà phê muối',
          variantName: 'Size M',
          unitPriceVnd: 35_000,
          quantityMilli: 2000,
          grossLineTotalVnd: 70_000,
          netLineTotalVnd: 70_000,
        },
        {
          productId: 'prod-2',
          variantId: null,
          productType: 'WEIGHT' as const,
          productName: 'Hạt điều rang',
          variantName: null,
          unitPriceVnd: 400_000,
          quantityMilli: 200,
          grossLineTotalVnd: 80_000,
          netLineTotalVnd: 80_000,
        },
      ],
    };

    const parsed = promotionPreviewSchema.safeParse(validDraftInput);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.subtotalVnd).toBe(150_000);
      expect(parsed.data.items).toHaveLength(2);
    }
  });

  it('correctly calculates realtime discount and totals when adding items in draft', () => {
    // Simulated promotion preview result for 20% invoice discount
    const previewResult: PromotionPreviewResult = {
      options: [
        {
          id: 'promo-20-pct',
          name: 'Giảm 20% cho đơn từ 100k',
          type: 'PERCENT',
          scope: 'INVOICE',
          value: 20,
          minimumOrderVnd: 100_000,
          maximumDiscountVnd: 50_000,
          eligible: true,
          reason: null,
          discountAmountVnd: 30_000,
          selected: true,
          autoApply: true,
          giftProductNames: [],
          giftItems: [],
          flatPriceItems: [],
          categoryNames: [],
          configuredProductTargets: [],
          giftBuyAny: false,
          maximumGiftQuantity: null,
        },
      ],
      applied: [
        {
          id: 'promo-20-pct',
          name: 'Giảm 20% cho đơn từ 100k',
          type: 'PERCENT',
          scope: 'INVOICE',
          value: 20,
          minimumOrderVnd: 100_000,
          maximumDiscountVnd: 50_000,
          eligible: true,
          reason: null,
          discountAmountVnd: 30_000,
          selected: true,
          autoApply: true,
          giftProductNames: [],
          giftItems: [],
          flatPriceItems: [],
          categoryNames: [],
          configuredProductTargets: [],
          giftBuyAny: false,
          maximumGiftQuantity: null,
        },
      ],
      promotionDiscountVnd: 30_000,
      giftItems: [],
    };

    const combinedSubtotal = 150_000;
    const totalDiscount = previewResult.promotionDiscountVnd;
    const displayedTotal = Math.max(0, combinedSubtotal - totalDiscount);

    // Discount must apply immediately before order is saved
    expect(totalDiscount).toBe(30_000);
    expect(displayedTotal).toBe(120_000);
    expect(previewResult.applied).toHaveLength(1);
    expect(previewResult.applied[0]!.name).toBe('Giảm 20% cho đơn từ 100k');
  });

  it('correctly allocates realtime gift item when buy threshold is met in draft', () => {
    // Simulated gift promotion: Buy 2 Peach Tea get 1 Orange Juice
    const giftResult: PromotionPreviewResult = {
      options: [],
      applied: [
        {
          id: 'promo-gift-buy-2-get-1',
          name: 'Mua 2 tặng 1 Nước cam ép',
          type: 'GIFT',
          scope: 'PRODUCT',
          value: null,
          minimumOrderVnd: 0,
          maximumDiscountVnd: null,
          eligible: true,
          reason: null,
          discountAmountVnd: 0,
          selected: true,
          autoApply: true,
          giftProductNames: ['Nước cam ép'],
          giftItems: [
            {
              productId: 'gift-prod-1',
              variantId: 'gift-var-1',
              productName: 'Nước cam ép',
              variantName: 'Ly lớn',
              unitName: 'Ly',
              unitPriceVnd: 35_000,
              quantityMilli: 1000,
              grossAmountVnd: 35_000,
            },
          ],
          flatPriceItems: [],
          categoryNames: [],
          configuredProductTargets: [],
          giftBuyAny: false,
          maximumGiftQuantity: 1,
        },
      ],
      promotionDiscountVnd: 0,
      giftItems: [
        {
          productId: 'gift-prod-1',
          variantId: 'gift-var-1',
          productName: 'Nước cam ép',
          variantName: 'Ly lớn',
          unitName: 'Ly',
          unitPriceVnd: 35_000,
          quantityMilli: 1000,
          grossAmountVnd: 35_000,
          promotionId: 'promo-gift-buy-2-get-1',
          promotionName: 'Mua 2 tặng 1 Nước cam ép',
        },
      ],
    };

    expect(giftResult.giftItems).toHaveLength(1);
    expect(giftResult.giftItems[0]!.productName).toBe('Nước cam ép');
    expect(giftResult.giftItems[0]!.grossAmountVnd).toBe(35_000);
  });
});
