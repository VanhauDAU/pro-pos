import { describe, expect, it } from 'vitest';

import { countTableUniqueItems } from '../../src/server/services/pos-service';

describe('countTableUniqueItems', () => {
  it('counts 1 item when quantity is greater than 1 for the same product (e.g., Sting x2)', () => {
    const items = [
      {
        productId: 'prod-sting',
        productType: 'QUANTITY',
        quantityMilli: 2000,
      },
    ];
    expect(countTableUniqueItems(items)).toBe(1);
  });

  it('counts multiple rows with the same productId as 1 distinct item', () => {
    const items = [
      {
        productId: 'prod-sting',
        productType: 'QUANTITY',
        quantityMilli: 1000,
      },
      {
        productId: 'prod-sting',
        productType: 'QUANTITY',
        quantityMilli: 2000,
      },
    ];
    expect(countTableUniqueItems(items)).toBe(1);
  });

  it('excludes TIME products from the count', () => {
    const items = [
      {
        productId: 'prod-billiards-table-1',
        productType: 'TIME',
        quantityMilli: 3600000,
      },
      {
        productId: 'prod-sting',
        productType: 'QUANTITY',
        quantityMilli: 2000,
      },
    ];
    expect(countTableUniqueItems(items)).toBe(1);
  });

  it('returns 0 when table has only TIME products', () => {
    const items = [
      {
        productId: 'prod-billiards-table-1',
        productType: 'TIME',
        quantityMilli: 3600000,
      },
    ];
    expect(countTableUniqueItems(items)).toBe(0);
  });

  it('counts distinct non-time products correctly', () => {
    const items = [
      {
        productId: 'prod-sting',
        productType: 'QUANTITY',
        quantityMilli: 2000,
      },
      {
        productId: 'prod-coffee',
        productType: 'QUANTITY',
        quantityMilli: 1000,
      },
      {
        productId: 'prod-karaoke-hour',
        productType: 'TIME',
        quantityMilli: 7200000,
      },
      {
        productId: 'prod-seafood-weight',
        productType: 'WEIGHT',
        quantityMilli: 1500,
      },
    ];
    // prod-sting (1), prod-coffee (1), prod-seafood-weight (1) = 3; prod-karaoke-hour (TIME) is excluded.
    expect(countTableUniqueItems(items)).toBe(3);
  });

  it('includes gift products and de-duplicates with existing products', () => {
    const items = [
      {
        productId: 'prod-sting',
        productType: 'QUANTITY',
        quantityMilli: 2000,
      },
    ];
    const gifts = [
      { productId: 'prod-sting' }, // Same as existing -> still 1
      { productId: 'prod-snack' }, // New gift item -> becomes 2
    ];
    expect(countTableUniqueItems(items, gifts)).toBe(2);
  });
});
