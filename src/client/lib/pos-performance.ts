import type {
  PosPerformanceBatch,
  PosPerformanceContext,
  PosPerformanceMetricName,
} from '@contracts/performance';

const SAMPLE_KEY = 'propos:performance-sampled';
const SESSION_KEY = 'propos:performance-session';
const SENT_KEY = 'propos:performance-sent';
const SAMPLE_RATE = 0.1;
const MAX_METRICS = 40;

interface NetworkInformationLike {
  effectiveType?: string;
}

interface PerformanceEventTimingLike extends PerformanceEntry {
  duration: number;
  interactionId?: number;
}

const metrics: PosPerformanceBatch['metrics'] = [];
const interactions = new Map<string, number>();
let initialized = false;
let sampled: boolean | null = null;
let sessionId: string | null = null;
let maxInp = 0;
let cumulativeLayoutShift = 0;
let csrfToken: string | null = null;

function randomSample() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0]! / 0x1_0000_0000 < SAMPLE_RATE;
}

function isSampled() {
  if (sampled !== null) return sampled;
  try {
    const stored = sessionStorage.getItem(SAMPLE_KEY);
    sampled = stored === null ? randomSample() : stored === '1';
    if (stored === null) sessionStorage.setItem(SAMPLE_KEY, sampled ? '1' : '0');
  } catch {
    sampled = randomSample();
  }
  return sampled;
}

function performanceSessionId() {
  if (sessionId) return sessionId;
  try {
    sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
  } catch {
    sessionId = crypto.randomUUID();
  }
  return sessionId;
}

function currentContext(): PosPerformanceContext {
  const path = window.location.pathname;
  if (path === '/pos/areas' || path === '/pos') return 'AREAS';
  if (path.endsWith('/payment')) return 'PAYMENT';
  if (path.startsWith('/pos/orders/')) return 'ORDER';
  return 'OTHER';
}

function effectiveType(): PosPerformanceBatch['device']['effectiveType'] {
  const value = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
    ?.effectiveType;
  return value === 'slow-2g' || value === '2g' || value === '3g' || value === '4g'
    ? value
    : 'unknown';
}

function queueMetric(
  name: PosPerformanceMetricName,
  value: number,
  context: PosPerformanceContext,
  status?: number,
) {
  if (!isSampled() || !Number.isFinite(value) || value < 0 || metrics.length >= MAX_METRICS) return;
  metrics.push({
    name,
    context,
    value: Math.round(value * 100) / 100,
    ...(status ? { status } : {}),
  });
}

export function startPosInteraction(name: string) {
  if (!isSampled()) return;
  interactions.set(name, performance.now());
}

export function finishPosInteraction(
  name: string,
  metric: Extract<PosPerformanceMetricName, 'TAP_TO_SHELL' | 'TAP_TO_VERIFIED'>,
  context: PosPerformanceContext,
) {
  const startedAt = interactions.get(name);
  if (startedAt === undefined) return;
  interactions.delete(name);
  queueMetric(metric, performance.now() - startedAt, context);
}

export function recordPosApiMetric(input: {
  context: PosPerformanceContext;
  method: string;
  status: number;
  durationMs: number;
}) {
  queueMetric(
    input.method === 'GET' ? 'API_REQUEST' : 'MUTATION_ACK',
    input.durationMs,
    input.context,
    input.status,
  );
}

function addObserver(
  type: string,
  callback: (entries: PerformanceEntryList) => void,
  buffered = true,
) {
  try {
    const observer = new PerformanceObserver((list) => callback(list.getEntries()));
    observer.observe({ type, buffered } as PerformanceObserverInit);
  } catch {
    // Unsupported metrics must not affect the POS runtime.
  }
}

export function initPosPerformanceMonitoring() {
  if (initialized || typeof window === 'undefined' || !isSampled()) return;
  initialized = true;

  addObserver('largest-contentful-paint', (entries) => {
    const last = entries.at(-1);
    if (last) queueMetric('LCP', last.startTime, currentContext());
  });
  addObserver('layout-shift', (entries) => {
    for (const entry of entries as Array<
      PerformanceEntry & { hadRecentInput?: boolean; value?: number }
    >) {
      if (!entry.hadRecentInput) cumulativeLayoutShift += entry.value ?? 0;
    }
  });
  addObserver('event', (entries) => {
    for (const entry of entries as PerformanceEventTimingLike[]) {
      if ((entry.interactionId ?? 0) > 0) maxInp = Math.max(maxInp, entry.duration);
    }
  });

  const flushFinalMetrics = () => {
    if (cumulativeLayoutShift > 0) queueMetric('CLS', cumulativeLayoutShift, currentContext());
    if (maxInp > 0) queueMetric('INP', maxInp, currentContext());
    flushPosPerformance();
  };
  window.addEventListener('pagehide', flushFinalMetrics, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushFinalMetrics();
  });
}

export function setPosPerformanceCsrfToken(token: string | null | undefined) {
  csrfToken = token ?? null;
}

export function flushPosPerformance() {
  if (!isSampled() || metrics.length === 0 || !csrfToken) return;
  try {
    if (sessionStorage.getItem(SENT_KEY) === '1') return;
    sessionStorage.setItem(SENT_KEY, '1');
  } catch {
    // Sending once is best-effort when storage is unavailable.
  }

  const payload: PosPerformanceBatch = {
    sessionId: performanceSessionId(),
    appVersion: typeof PROPOS_APP_VERSION === 'string' ? PROPOS_APP_VERSION : 'unknown',
    route: currentContext(),
    device: {
      viewportWidth: Math.max(240, Math.min(4096, window.innerWidth)),
      effectiveType: effectiveType(),
      standalone: window.matchMedia('(display-mode: standalone)').matches,
    },
    metrics: metrics.splice(0, metrics.length),
    occurredAt: Date.now(),
  };
  const body = JSON.stringify(payload);
  void fetch('/api/v1/pos/performance', {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body,
  });
}

export function posApiContext(path: string): PosPerformanceContext {
  if (path.endsWith('/overview')) return 'OVERVIEW';
  if (path.includes('/quote')) return 'QUOTE';
  if (path.endsWith('/orders/open') || path.endsWith('/tables/open')) return 'OPEN';
  if (path.endsWith('/save')) return 'SAVE';
  if (path.endsWith('/cancel')) return 'CANCEL';
  if (path.endsWith('/stop-time')) return 'STOP_TIME';
  if (path.endsWith('/checkout')) return 'CHECKOUT';
  return 'OTHER';
}
