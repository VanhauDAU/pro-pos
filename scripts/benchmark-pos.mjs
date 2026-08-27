/* eslint-disable no-await-in-loop -- measurements and stateful POS mutations must be sequential. */

import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.E2E_BASE_URL;
const required = ['E2E_BASE_URL', 'E2E_POS_USERNAME', 'E2E_POS_PIN'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}; see tests/e2e/README.md.`);
}
const ownerUsername = process.env.E2E_OWNER_USERNAME ?? process.env.E2E_USERNAME;
const ownerPassword = process.env.E2E_OWNER_PASSWORD ?? process.env.E2E_PASSWORD;
if (!ownerUsername || !ownerPassword) {
  throw new Error('Missing E2E_OWNER_USERNAME/E2E_USERNAME or E2E_OWNER_PASSWORD/E2E_PASSWORD.');
}
if (process.env.E2E_BENCHMARK_ENABLED !== 'true') {
  throw new Error('Set E2E_BENCHMARK_ENABLED=true to allow staging order mutations.');
}

const metricNames = [
  'auth',
  'store',
  'permission',
  'cmd_prepare',
  'cmd_pricing',
  'cmd_promotion',
  'cmd_atomic',
  'cmd_snapshot',
  'cmd_complete',
  'snapshot_quote',
  'snapshot_tables',
  'snapshot_call_batch',
  'overview_base',
  'overview_batch_load',
  'overview_pricing',
  'overview_quotes',
  'overview',
  'command',
  'total',
];

function parseServerTiming(header) {
  const values = Object.fromEntries(metricNames.map((name) => [name, null]));
  if (!header) return values;
  for (const part of header.split(',')) {
    const match = /^\s*([^;]+);\s*dur=([\d.]+)/u.exec(part);
    if (match && metricNames.includes(match[1])) values[match[1]] = Number(match[2]);
  }
  return values;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function summary(samples, metric) {
  const browser = samples.map((measurement) => measurement.browserMs);
  const server = samples
    .map((measurement) => measurement.serverTiming[metric] ?? measurement.serverTiming.total)
    .filter(Number.isFinite);
  return {
    browser: {
      min: Math.min(...browser),
      median: percentile(browser, 0.5),
      max: Math.max(...browser),
      p95: percentile(browser, 0.95),
    },
    server: server.length
      ? {
          min: Math.min(...server),
          median: percentile(server, 0.5),
          max: Math.max(...server),
          p95: percentile(server, 0.95),
        }
      : null,
  };
}

function dominantTiming(samples) {
  const medians = metricNames
    .filter((name) => name !== 'total')
    .map((name) => [
      name,
      percentile(
        samples.map((measurement) => measurement.serverTiming[name]).filter(Number.isFinite),
        0.5,
      ),
    ])
    .filter(([, value]) => value !== null);
  return medians.toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? 'n/a';
}

async function authenticate(page) {
  await page.goto(`${baseURL}/device-activation`);
  await page.getByPlaceholder('Tên đăng nhập hoặc Email').fill(ownerUsername);
  await page.getByPlaceholder('Mật khẩu Owner').fill(ownerPassword);
  await page
    .getByPlaceholder('Ví dụ: Máy thu ngân chính')
    .fill(process.env.E2E_DEVICE_NAME ?? 'Playwright benchmark');
  await page.getByRole('button', { name: 'Kích hoạt máy POS' }).click();
  await page.getByPlaceholder('Tên đăng nhập').fill(process.env.E2E_POS_USERNAME);
  await page.getByLabel('Mã PIN 4 số').fill(process.env.E2E_POS_PIN);
  await page.waitForURL(/\/pos(?:\/|$)/u, { timeout: 15_000 });
}

async function api(page, path, options = {}) {
  const response = await page.evaluate(
    async ({ requestPath, requestOptions }) => {
      const startedAt = performance.now();
      const fetchResponse = await fetch(requestPath, requestOptions);
      return {
        browserMs: performance.now() - startedAt,
        status: fetchResponse.status,
        timing: fetchResponse.headers.get('Server-Timing'),
        body: await fetchResponse.json(),
      };
    },
    { requestPath: path, requestOptions: options },
  );
  if (response.status < 200 || response.status >= 300 || !response.body.data) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed (${response.status}).`);
  }
  return {
    browserMs: response.browserMs,
    serverTiming: parseServerTiming(response.timing),
    data: response.body.data,
  };
}

async function csrf(page) {
  return (await api(page, '/api/v1/auth/context')).data.csrfToken;
}

async function mutation(page, path, body) {
  const token = await csrf(page);
  return api(page, path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

async function product(page) {
  const catalog = (await api(page, '/api/v1/pos/catalog')).data;
  const item = catalog.find(
    (candidate) =>
      candidate.productType === 'QUANTITY' &&
      candidate.variants.some((variant) => variant.salePriceVnd !== null),
  );
  const variant = item?.variants.find((candidate) => candidate.salePriceVnd !== null);
  if (!item || !variant) throw new Error('Benchmark store needs a priced quantity product.');
  return { productId: item.productId, variantId: variant.id };
}

async function openTakeaway(page, item) {
  return mutation(page, '/api/v1/pos/orders/open', {
    orderType: 'TAKEAWAY',
    items: [{ ...item, quantityMilli: 1000, note: 'Playwright benchmark' }],
  });
}

async function openTimedDineIn(page, item) {
  const tables = (await api(page, '/api/v1/pos/tables')).data;
  const table = tables.find(
    (candidate) => candidate.status === 'AVAILABLE' && candidate.timeProductId,
  );
  if (!table) throw new Error('Benchmark store needs an available time-tracked table.');
  return mutation(page, '/api/v1/pos/orders/open', {
    orderType: 'DINE_IN',
    tableId: table.id,
    expectedTableVersion: table.version,
    items: [{ ...item, quantityMilli: 1000, note: 'Playwright benchmark' }],
  });
}

async function cancel(page, orderId) {
  const quote = (await api(page, `/api/v1/pos/orders/${orderId}/quote`)).data;
  if (!['OPEN', 'PAYMENT_PENDING'].includes(quote.order.status)) return;
  await mutation(page, `/api/v1/pos/orders/${orderId}/cancel`, {
    expectedOrderVersion: quote.order.version,
    reason: 'Playwright benchmark cleanup',
  });
}

async function collectSamples(page, endpoint, fn) {
  await fn(); // warm-up, intentionally excluded from reporting
  const samples = [];
  for (let index = 0; index < 5; index += 1) samples.push(await fn());
  return { endpoint, samples };
}

const browser = await chromium.launch();
const page = await browser.newPage({ baseURL });
const createdOrderIds = new Set();
try {
  await authenticate(page);
  const item = await product(page);
  const scenarios = [];
  for (const activeOrders of [1, 5, 10, 20]) {
    const seeded = [];
    for (let index = 0; index < activeOrders; index += 1) {
      const result = await openTakeaway(page, item);
      seeded.push(result.data.order.id);
      createdOrderIds.add(result.data.order.id);
    }

    const endpoints = [];
    endpoints.push(
      await collectSamples(page, 'GET /api/v1/pos/overview', () =>
        api(page, '/api/v1/pos/overview'),
      ),
    );
    endpoints.push(
      await collectSamples(page, 'GET /api/v1/pos/orders/:id/quote', () =>
        api(page, `/api/v1/pos/orders/${seeded[0]}/quote`),
      ),
    );
    endpoints.push(
      await collectSamples(page, 'POST /api/v1/pos/orders/open', async () => {
        const result = await openTakeaway(page, item);
        createdOrderIds.add(result.data.order.id);
        await cancel(page, result.data.order.id);
        return result;
      }),
    );
    endpoints.push(
      await collectSamples(page, 'POST /api/v1/pos/orders/:id/save', async () => {
        const opened = await openTakeaway(page, item);
        const orderId = opened.data.order.id;
        createdOrderIds.add(orderId);
        const result = await mutation(page, `/api/v1/pos/orders/${orderId}/save`, {
          expectedOrderVersion: opened.data.quote.order.version,
          nextAction: 'STAY',
          addedItems: [],
          updatedItems: [],
        });
        await cancel(page, orderId);
        return result;
      }),
    );
    endpoints.push(
      await collectSamples(page, 'POST /api/v1/pos/orders/:id/stop-time', async () => {
        const opened = await openTimedDineIn(page, item);
        const orderId = opened.data.order.id;
        createdOrderIds.add(orderId);
        const result = await mutation(page, `/api/v1/pos/orders/${orderId}/stop-time`, {
          expectedOrderVersion: opened.data.quote.order.version,
        });
        await cancel(page, orderId);
        return result;
      }),
    );
    endpoints.push(
      await collectSamples(page, 'POST /api/v1/pos/orders/:id/checkout', async () => {
        const opened = await openTakeaway(page, item);
        const orderId = opened.data.order.id;
        createdOrderIds.add(orderId);
        return mutation(page, `/api/v1/pos/orders/${orderId}/checkout`, {
          expectedOrderVersion: opened.data.quote.order.version,
          method: 'CASH',
          cashReceivedVnd: opened.data.quote.totalVnd,
        });
      }),
    );
    scenarios.push({ activeOrders, endpoints });
    await Promise.all(seeded.map((id) => cancel(page, id)));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? process.env.BUILD_SHA ?? 'unknown',
    branch: process.env.GITHUB_REF_NAME ?? 'local',
    baseURL,
    browser: 'chromium',
    measurements: 5,
    limitations: [
      'The benchmark mutates only the dedicated E2E store and cleans up open/PAYMENT_PENDING orders.',
      'A time-tracked available table is required to measure stop-time.',
    ],
    scenarios,
  };
  const rows = scenarios.flatMap((scenario) =>
    scenario.endpoints.map((endpoint) => {
      const totals = summary(endpoint.samples, 'total');
      return {
        scenario: `${scenario.activeOrders} active orders`,
        endpoint: endpoint.endpoint,
        browser: totals.browser.median,
        server: totals.server?.median ?? null,
        max: totals.browser.max,
        dominant: dominantTiming(endpoint.samples),
      };
    }),
  );
  const metricRows = scenarios.flatMap((scenario) =>
    scenario.endpoints.flatMap((endpoint) =>
      metricNames
        .filter((metric) =>
          endpoint.samples.some((measurement) => measurement.serverTiming[metric] !== null),
        )
        .map(
          (metric) =>
            `| ${scenario.activeOrders} active / ${endpoint.endpoint} | ${metric} | ${percentile(endpoint.samples.map((measurement) => measurement.serverTiming[metric]).filter(Number.isFinite), 0.5).toFixed(1)} ms |`,
        ),
    ),
  );
  const markdown = [
    '# POS staging benchmark',
    '',
    `Generated: ${report.generatedAt}`,
    `Base URL: ${baseURL}`,
    `Commit: ${report.commit} · Branch: ${report.branch} · Browser: Chromium · Measurements: 5 (+ 1 warm-up)`,
    '',
    '| Scenario | Endpoint | Median browser | Median server | Max | Dominant timing |',
    '|---|---|---:|---:|---:|---|',
    ...rows.map(
      (row) =>
        `| ${row.scenario} | ${row.endpoint} | ${row.browser.toFixed(1)} ms | ${row.server?.toFixed(1) ?? 'n/a'} ms | ${row.max.toFixed(1)} ms | ${row.dominant} |`,
    ),
    '',
    '## Server-Timing medians',
    '',
    '| Endpoint | Metric | Median |',
    '|---|---|---:|',
    ...metricRows,
    '',
    '## Limitations',
    '',
    ...report.limitations.map((limitation) => `- ${limitation}`),
    '',
  ].join('\n');
  await mkdir('artifacts/perf', { recursive: true });
  await Promise.all([
    writeFile('artifacts/perf/pos-staging-benchmark.json', `${JSON.stringify(report, null, 2)}\n`),
    writeFile('artifacts/perf/pos-staging-benchmark.md', markdown),
  ]);
  console.log('Wrote artifacts/perf/pos-staging-benchmark.{json,md}');
} finally {
  await Promise.all([...createdOrderIds].map((id) => cancel(page, id).catch(() => undefined)));
  await browser.close();
}
