interface PendingPrintMetric {
  startedAt: number;
  trackedAt: number;
}

const pendingPrints = new Map<string, PendingPrintMetric>();
const METRIC_TTL_MS = 10 * 60_000;
const MAX_PENDING_METRICS = 200;

function prune(now: number): void {
  for (const [jobId, metric] of pendingPrints) {
    if (now - metric.trackedAt > METRIC_TTL_MS || pendingPrints.size > MAX_PENDING_METRICS) {
      pendingPrints.delete(jobId);
    }
  }
}

export function trackPwaPrintRequest(
  jobId: string,
  startedAt = performance.now(),
  trackedAt = Date.now(),
): void {
  prune(trackedAt);
  pendingPrints.set(jobId, { startedAt, trackedAt });
}

export function recordPwaPrintTcpStart(
  jobId: string | undefined,
  eventId: string,
  now = performance.now(),
): number | null {
  if (!jobId) return null;
  const metric = pendingPrints.get(jobId);
  if (!metric) return null;
  pendingPrints.delete(jobId);
  const durationMs = Math.max(0, now - metric.startedAt);
  console.info(
    JSON.stringify({
      level: 'info',
      message: 'pwa print request to tcp start',
      jobId,
      eventId,
      durationMs: Math.round(durationMs * 10) / 10,
    }),
  );
  return durationMs;
}
