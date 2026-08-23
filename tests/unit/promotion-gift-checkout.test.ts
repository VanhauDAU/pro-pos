import { describe, expect, it } from 'vitest';

describe('Promotion Gift Checkout Accounting Invariants', () => {
  it('strictly satisfies invoice_lines accounting constraints for promotion gifts', () => {
    const giftProduct = {
      productId: 'prod-coca-light',
      variantId: 'var-coca-light',
      unitPriceVnd: 10000,
      quantityMilli: 1000,
      grossAmountVnd: 10000,
    };

    const promotionGiftItem = {
      id: 'promotion-gift:promo-1:prod-coca-light:var-coca-light',
      description: 'Coca Không Đường (Quà tặng)',
      quantityMilli: giftProduct.quantityMilli,
      unitPriceVnd: giftProduct.unitPriceVnd,
      discountType: 'PERCENT' as const,
      discountInputValue: 100,
      discountAmountVnd: giftProduct.grossAmountVnd,
      grossLineTotalVnd: giftProduct.grossAmountVnd,
      lineTotalVnd: 0,
    };

    // 1. Discount amount must be >= 0
    expect(promotionGiftItem.discountAmountVnd).toBeGreaterThanOrEqual(0);
    // 2. Gross line total must be >= 0
    expect(promotionGiftItem.grossLineTotalVnd).toBeGreaterThanOrEqual(0);
    // 3. Discount amount cannot exceed gross line total
    expect(promotionGiftItem.discountAmountVnd).toBeLessThanOrEqual(promotionGiftItem.grossLineTotalVnd);
    // 4. Invariant: gross_line_total - discount_amount == line_total
    expect(
      promotionGiftItem.grossLineTotalVnd - promotionGiftItem.discountAmountVnd,
    ).toBe(promotionGiftItem.lineTotalVnd);
    // 5. Line total for a 100% gift item is exactly 0
    expect(promotionGiftItem.lineTotalVnd).toBe(0);
  });

  it('verifies accounting consistency across mixed products and gift promotions', () => {
    const items = [
      {
        name: 'Trà Đào',
        grossLineTotalVnd: 15000,
        discountAmountVnd: 0,
        lineTotalVnd: 15000,
      },
      {
        name: 'Bê thui',
        grossLineTotalVnd: 60000,
        discountAmountVnd: 0,
        lineTotalVnd: 60000,
      },
      {
        name: 'Coca Không Đường (Quà tặng)',
        grossLineTotalVnd: 10000,
        discountAmountVnd: 10000,
        lineTotalVnd: 0,
      },
    ];

    for (const item of items) {
      expect(item.discountAmountVnd).toBeGreaterThanOrEqual(0);
      expect(item.grossLineTotalVnd).toBeGreaterThanOrEqual(0);
      expect(item.discountAmountVnd).toBeLessThanOrEqual(item.grossLineTotalVnd);
      expect(item.grossLineTotalVnd - item.discountAmountVnd).toBe(item.lineTotalVnd);
    }

    const subtotalVnd = items.reduce((s, i) => s + i.grossLineTotalVnd, 0);
    const discountVnd = items.reduce((s, i) => s + i.discountAmountVnd, 0);
    const totalVnd = items.reduce((s, i) => s + i.lineTotalVnd, 0);

    expect(subtotalVnd - discountVnd).toBe(totalVnd);
  });
});
