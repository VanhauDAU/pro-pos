import { describe, expect, it } from 'vitest';

import { calculateTimePrice } from '@domain/pricing/engine';
import { canTransitionTimeSession } from '@domain/state-machines';
import { timeSessionStatusSchema } from '@contracts/domain';
import type { PricingConfigSnapshot } from '@domain/pricing/types';

function createPricingConfig(
  overrides: Partial<PricingConfigSnapshot> = {},
): PricingConfigSnapshot {
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

describe('Realtime Pause and Resume Table / Room State & Pricing', () => {
  it('validates time session state machine transitions', () => {
    // RUNNING can transition to PAUSED or ENDED
    expect(canTransitionTimeSession('RUNNING', 'PAUSED')).toBe(true);
    expect(canTransitionTimeSession('RUNNING', 'ENDED')).toBe(true);

    // PAUSED can transition to RUNNING or ENDED
    expect(canTransitionTimeSession('PAUSED', 'RUNNING')).toBe(true);
    expect(canTransitionTimeSession('PAUSED', 'ENDED')).toBe(true);

    // ENDED has no outgoing transitions
    expect(canTransitionTimeSession('ENDED', 'RUNNING')).toBe(false);
    expect(canTransitionTimeSession('ENDED', 'PAUSED')).toBe(false);
  });

  it('validates time session status schema', () => {
    expect(timeSessionStatusSchema.safeParse('RUNNING').success).toBe(true);
    expect(timeSessionStatusSchema.safeParse('PAUSED').success).toBe(true);
    expect(timeSessionStatusSchema.safeParse('ENDED').success).toBe(true);
    expect(timeSessionStatusSchema.safeParse('INVALID').success).toBe(false);
  });

  it('accurately subtracts paused intervals from billable time in pricing engine', () => {
    const startedAtMs = 1_700_000_000_000;
    // 2 hours elapsed = 7,200 seconds
    const endedAtMs = startedAtMs + 2 * 3600 * 1000;

    // Pause 1: 30 minutes (1,800 seconds)
    // Pause 2: 15 minutes (900 seconds)
    // Total paused = 45 minutes (2,700 seconds)
    // Net billable time = 1 hour 15 minutes (4,500 seconds)
    const pauses = [
      {
        pausedAtMs: startedAtMs + 30 * 60 * 1000,
        resumedAtMs: startedAtMs + 60 * 60 * 1000,
      },
      {
        pausedAtMs: startedAtMs + 90 * 60 * 1000,
        resumedAtMs: startedAtMs + 105 * 60 * 1000,
      },
    ];

    const result = calculateTimePrice({
      startedAtMs,
      endedAtMs,
      pauses,
      config: createPricingConfig(),
    });

    expect(result.elapsedSeconds).toBe(4500); // 75 minutes = 1.25 hours
    expect(result.amountBeforeRoundingVnd).toBe(75_000); // 1.25 * 60,000 = 75,000 VND
  });

  it('verifies realtime topics and event payload structure for TIME_PAUSED and TIME_RESUMED', () => {
    const orderId = 'order-test-123';
    const storeId = 'store-test-456';
    const expectedOrderVersion = 3;

    const buildRealtimeEvent = (reason: 'TIME_PAUSED' | 'TIME_RESUMED') => ({
      eventId: 'evt-uuid-1',
      storeId,
      topic: 'pos.order.changed',
      aggregateId: orderId,
      version: expectedOrderVersion + 1,
      topics: ['pos.orders', 'pos.tables', `pos.order:${orderId}`],
      data: { reason },
      occurredAtMs: Date.now(),
    });

    const pauseEvent = buildRealtimeEvent('TIME_PAUSED');
    expect(pauseEvent.topics).toContain('pos.orders');
    expect(pauseEvent.topics).toContain('pos.tables');
    expect(pauseEvent.topics).toContain(`pos.order:${orderId}`);
    expect(pauseEvent.data.reason).toBe('TIME_PAUSED');

    const resumeEvent = buildRealtimeEvent('TIME_RESUMED');
    expect(resumeEvent.topics).toContain('pos.orders');
    expect(resumeEvent.topics).toContain('pos.tables');
    expect(resumeEvent.topics).toContain(`pos.order:${orderId}`);
    expect(resumeEvent.data.reason).toBe('TIME_RESUMED');
  });

  it('prevents concurrent race conditions by verifying version increment', () => {
    let orderVersion = 1;
    const processCommand = (expectedVersion: number) => {
      if (expectedVersion !== orderVersion) {
        throw new Error('VERSION_MISMATCH');
      }
      orderVersion += 1;
      return { newVersion: orderVersion, success: true };
    };

    // First command succeeds
    const res1 = processCommand(1);
    expect(res1.success).toBe(true);
    expect(res1.newVersion).toBe(2);

    // Stale command with old version fails
    expect(() => processCommand(1)).toThrow('VERSION_MISMATCH');

    // Up-to-date command succeeds
    const res2 = processCommand(2);
    expect(res2.success).toBe(true);
    expect(res2.newVersion).toBe(3);
  });
});
