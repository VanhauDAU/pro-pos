import type { Context } from 'hono';

import type { AppEnv } from '@server/types';

export function addRequestTiming(c: Context<AppEnv>, name: string, durationMs: number) {
  const timings = c.get('requestTimings');
  timings[name] = (timings[name] ?? 0) + durationMs;
}

export async function measureRequestTiming<T>(
  c: Context<AppEnv>,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    addRequestTiming(c, name, performance.now() - startedAt);
  }
}

export function serverTimingHeader(timings: Record<string, number>) {
  return Object.entries(timings)
    .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
    .join(', ');
}
