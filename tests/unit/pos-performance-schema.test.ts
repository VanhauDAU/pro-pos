import { describe, expect, it } from 'vitest';

import { posPerformanceBatchSchema } from '../../src/contracts/performance';

describe('POS performance telemetry schema', () => {
  const valid = {
    sessionId: '10000000-0000-4000-8000-000000000001',
    appVersion: '0.1.0',
    route: 'AREAS',
    device: { viewportWidth: 390, effectiveType: '4g', standalone: true },
    metrics: [{ name: 'LCP', context: 'AREAS', value: 1385.2 }],
    occurredAt: 1_788_106_789_000,
  } as const;

  it('accepts bounded anonymous UX metrics', () => {
    expect(posPerformanceBatchSchema.parse(valid)).toEqual(valid);
  });

  it('rejects business identifiers and oversized batches', () => {
    expect(() =>
      posPerformanceBatchSchema.parse({ ...valid, orderId: crypto.randomUUID() }),
    ).toThrow();
    expect(() =>
      posPerformanceBatchSchema.parse({
        ...valid,
        metrics: Array.from({ length: 51 }, () => valid.metrics[0]),
      }),
    ).toThrow();
  });
});
