import { describe, expect, it } from 'vitest';

import { calculateTimePrice } from '@domain/pricing/engine';
import type { PricingConfigSnapshot } from '@domain/pricing/types';
import { PricingConfigurationError } from '@domain/pricing/validation';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function config(overrides: Partial<PricingConfigSnapshot> = {}): PricingConfigSnapshot {
  return {
    version: 1,
    timezone: 'Asia/Ho_Chi_Minh',
    basePriceVnd: 60_000,
    baseDurationSeconds: 3600,
    calculationMode: 'ACTUAL_TIME',
    roundingUnitVnd: 0,
    firstPeriod: { enabled: false },
    specialWindows: [],
    ...overrides,
  };
}

describe('calculateTimePrice', () => {
  const start = Date.parse('2026-08-17T13:00:00.000Z'); // 20:00 in Ho Chi Minh City.

  it.each([
    [1, 1_000],
    [59, 59_000],
    [60, 60_000],
    [61, 61_000],
  ])('charges ACTUAL_TIME for %i minutes', (minutes, expected) => {
    const result = calculateTimePrice({
      startedAtMs: start,
      endedAtMs: start + minutes * MINUTE,
      config: config(),
    });
    expect(result.amountAfterRoundingVnd).toBe(expected);
  });

  it.each([
    [1, 60_000],
    [59, 60_000],
    [60, 60_000],
    [61, 120_000],
  ])('charges TIME_BLOCK for %i minutes', (minutes, expected) => {
    const result = calculateTimePrice({
      startedAtMs: start,
      endedAtMs: start + minutes * MINUTE,
      config: config({ calculationMode: 'TIME_BLOCK' }),
    });
    expect(result.amountAfterRoundingVnd).toBe(expected);
  });

  it('applies first period before special and base pricing', () => {
    const result = calculateTimePrice({
      startedAtMs: start,
      endedAtMs: start + 90 * MINUTE,
      config: config({
        firstPeriod: { enabled: true, durationSeconds: 3600, priceVnd: 70_000 },
        specialWindows: [
          {
            id: 'evening',
            name: 'Giờ tối',
            priceVnd: 90_000,
            startMinute: 21 * 60,
            endMinute: 23 * 60,
            weekdaysMask: 127,
          },
        ],
      }),
    });
    expect(result.amountAfterRoundingVnd).toBe(115_000);
    expect(result.segments.map((segment) => segment.type)).toEqual(['FIRST_PERIOD', 'SPECIAL']);
  });

  it('splits an ACTUAL_TIME session at a special-price boundary', () => {
    const result = calculateTimePrice({
      startedAtMs: Date.parse('2026-08-17T13:30:00.000Z'), // 20:30
      endedAtMs: Date.parse('2026-08-17T14:30:00.000Z'), // 21:30
      config: config({
        specialWindows: [
          {
            id: 'evening',
            name: 'Giờ tối',
            priceVnd: 90_000,
            startMinute: 21 * 60,
            endMinute: 23 * 60,
            weekdaysMask: 127,
          },
        ],
      }),
    });
    expect(result.amountAfterRoundingVnd).toBe(75_000);
    expect(result.segments).toHaveLength(2);
  });

  it('charges each TIME_BLOCK price segment independently', () => {
    const result = calculateTimePrice({
      startedAtMs: Date.parse('2026-08-17T13:30:00.000Z'),
      endedAtMs: Date.parse('2026-08-17T14:30:00.000Z'),
      config: config({
        calculationMode: 'TIME_BLOCK',
        specialWindows: [
          {
            id: 'evening',
            name: 'Giờ tối',
            priceVnd: 90_000,
            startMinute: 21 * 60,
            endMinute: 23 * 60,
            weekdaysMask: 127,
          },
        ],
      }),
    });
    expect(result.amountAfterRoundingVnd).toBe(150_000);
  });

  it('handles an overnight special window using the starting weekday', () => {
    const result = calculateTimePrice({
      startedAtMs: Date.parse('2026-08-17T16:30:00.000Z'), // Monday 23:30
      endedAtMs: Date.parse('2026-08-17T18:30:00.000Z'), // Tuesday 01:30
      config: config({
        specialWindows: [
          {
            id: 'overnight',
            name: 'Đêm thứ hai',
            priceVnd: 90_000,
            startMinute: 22 * 60,
            endMinute: 2 * 60,
            weekdaysMask: 1,
          },
        ],
      }),
    });
    expect(result.amountAfterRoundingVnd).toBe(180_000);
    expect(result.segments).toHaveLength(1);
  });

  it('excludes paused time', () => {
    const result = calculateTimePrice({
      startedAtMs: start,
      endedAtMs: start + 2 * HOUR,
      pauses: [{ pausedAtMs: start + 30 * MINUTE, resumedAtMs: start + 90 * MINUTE }],
      config: config(),
    });
    expect(result.elapsedSeconds).toBe(3600);
    expect(result.amountAfterRoundingVnd).toBe(60_000);
  });

  it('does not start a new TIME_BLOCK when the same tariff resumes after a pause', () => {
    const result = calculateTimePrice({
      startedAtMs: start,
      endedAtMs: start + 2 * HOUR,
      pauses: [{ pausedAtMs: start + 30 * MINUTE, resumedAtMs: start + 90 * MINUTE }],
      config: config({ calculationMode: 'TIME_BLOCK' }),
    });
    expect(result.elapsedSeconds).toBe(3600);
    expect(result.amountAfterRoundingVnd).toBe(60_000);
    expect(result.segments).toHaveLength(1);
  });

  it('counts only active time toward the first-period duration', () => {
    const result = calculateTimePrice({
      startedAtMs: start,
      endedAtMs: start + 2 * HOUR,
      pauses: [{ pausedAtMs: start + 30 * MINUTE, resumedAtMs: start + HOUR }],
      config: config({
        firstPeriod: { enabled: true, durationSeconds: 3600, priceVnd: 70_000 },
      }),
    });
    expect(result.elapsedSeconds).toBe(5400);
    expect(result.amountAfterRoundingVnd).toBe(100_000);
    expect(result.segments.map((segment) => segment.type)).toEqual([
      'FIRST_PERIOD',
      'FIRST_PERIOD',
      'BASE',
    ]);
  });

  it('switches from special to regular price at the exact end boundary', () => {
    const result = calculateTimePrice({
      startedAtMs: Date.parse('2026-08-17T15:30:00.000Z'), // 22:30
      endedAtMs: Date.parse('2026-08-17T16:30:00.000Z'), // 23:30
      config: config({
        specialWindows: [
          {
            id: 'evening',
            name: 'Giờ tối',
            priceVnd: 90_000,
            startMinute: 21 * 60,
            endMinute: 23 * 60,
            weekdaysMask: 127,
          },
        ],
      }),
    });
    expect(result.amountAfterRoundingVnd).toBe(75_000);
    expect(result.segments.map((segment) => segment.type)).toEqual(['SPECIAL', 'BASE']);
  });

  it('accepts adjacent special windows and applies each price once', () => {
    const result = calculateTimePrice({
      startedAtMs: Date.parse('2026-08-17T13:30:00.000Z'), // 20:30
      endedAtMs: Date.parse('2026-08-17T14:30:00.000Z'), // 21:30
      config: config({
        specialWindows: [
          {
            id: 'early',
            name: 'Sớm',
            priceVnd: 70_000,
            startMinute: 20 * 60,
            endMinute: 21 * 60,
            weekdaysMask: 127,
          },
          {
            id: 'late',
            name: 'Muộn',
            priceVnd: 90_000,
            startMinute: 21 * 60,
            endMinute: 22 * 60,
            weekdaysMask: 127,
          },
        ],
      }),
    });
    expect(result.amountAfterRoundingVnd).toBe(80_000);
    expect(result.segments.map((segment) => segment.name)).toEqual(['Sớm', 'Muộn']);
  });

  it('rounds once after summing all actual-time segments', () => {
    const result = calculateTimePrice({
      startedAtMs: start,
      endedAtMs: start + 25.5 * MINUTE,
      config: config({ roundingUnitVnd: 1000 }),
    });
    expect(result.amountBeforeRoundingVnd).toBe(25_500);
    expect(result.amountAfterRoundingVnd).toBe(26_000);
  });

  it('rejects overlapping special windows', () => {
    expect(() =>
      calculateTimePrice({
        startedAtMs: start,
        endedAtMs: start + HOUR,
        config: config({
          specialWindows: [
            {
              id: 'a',
              name: 'A',
              priceVnd: 70_000,
              startMinute: 20 * 60,
              endMinute: 22 * 60,
              weekdaysMask: 127,
            },
            {
              id: 'b',
              name: 'B',
              priceVnd: 80_000,
              startMinute: 21 * 60,
              endMinute: 23 * 60,
              weekdaysMask: 127,
            },
          ],
        }),
      }),
    ).toThrow(PricingConfigurationError);
  });

  it('efficiently calculates multi-day sessions (5-6 days) without timeout', () => {
    const days = 6;
    const sixDaysMs = days * 24 * HOUR;
    const t0 = performance.now();
    const result = calculateTimePrice({
      startedAtMs: start - sixDaysMs,
      endedAtMs: start,
      config: config({
        firstPeriod: { enabled: true, durationSeconds: 3600, priceVnd: 70_000 },
        specialWindows: [
          {
            id: 'evening',
            name: 'Giờ tối',
            priceVnd: 90_000,
            startMinute: 21 * 60,
            endMinute: 23 * 60,
            weekdaysMask: 127,
          },
        ],
      }),
    });
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(50);
    expect(result.elapsedSeconds).toBe(days * 24 * 3600);
    expect(result.amountAfterRoundingVnd).toBeGreaterThan(0);
  });

  it('accurately calculates a 30-day session with actual time', () => {
    const thirtyDaysMs = 30 * 24 * HOUR;
    const result = calculateTimePrice({
      startedAtMs: start - thirtyDaysMs,
      endedAtMs: start,
      config: config(),
    });
    expect(result.elapsedSeconds).toBe(30 * 24 * 3600);
    // 30 days * 24 hours * 60,000 VND/hour = 43,200,000 VND
    expect(result.amountAfterRoundingVnd).toBe(30 * 24 * 60_000);
  });
});
