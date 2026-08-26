import { expect, type Page } from '@playwright/test';

interface Envelope<T> {
  data: T;
}

interface AuthContext {
  csrfToken: string | null;
}

export interface PosTable {
  id: string;
  name: string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'DISABLED';
  version: number;
  activeOrderId: string | null;
  timeProductId?: string | null;
}

interface CatalogVariant {
  id: string;
  salePriceVnd: number | null;
}

interface CatalogProduct {
  productId: string;
  productType: 'QUANTITY' | 'WEIGHT';
  variants: CatalogVariant[];
}

export interface OrderQuote {
  order: {
    id: string;
    version: number;
    status: 'OPEN' | 'PAYMENT_PENDING' | 'COMPLETED' | 'CANCELLED';
    tableId: string | null;
  };
  items: Array<{ id: string }>;
  time?: { status: 'RUNNING' | 'PAUSED' | 'ENDED' } | null;
}

interface OpenOrderResult {
  order: { id: string; version: number };
  quote: OrderQuote;
}

async function api<T>(page: Page, path: string, init?: { method?: string; data?: unknown }) {
  const headers = init?.method && init.method !== 'GET' ? await mutationHeaders(page) : undefined;
  const response = await page.request.fetch(path, {
    method: init?.method ?? 'GET',
    data: init?.data,
    ...(headers ? { headers } : {}),
  });
  const payload = (await response.json()) as Envelope<T> | { error: { message: string } };
  if (!response.ok || !('data' in payload)) {
    const message = 'error' in payload ? payload.error.message : response.statusText();
    throw new Error(`${init?.method ?? 'GET'} ${path} failed (${response.status()}): ${message}`);
  }
  return payload.data;
}

async function mutationHeaders(page: Page) {
  const context = await api<AuthContext>(page, '/api/v1/auth/context');
  if (!context.csrfToken)
    throw new Error('Authenticated E2E session did not provide a CSRF token.');
  return {
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID(),
    'X-CSRF-Token': context.csrfToken,
  };
}

async function availableTimedTable(page: Page) {
  const tables = await api<PosTable[]>(page, '/api/v1/pos/tables');
  const table = tables.find((item) => item.status === 'AVAILABLE' && item.timeProductId);
  if (!table) {
    throw new Error('The E2E store needs one available table with time tracking enabled.');
  }
  return table;
}

async function sellableProduct(page: Page) {
  const catalog = await api<CatalogProduct[]>(page, '/api/v1/pos/catalog');
  const product = catalog.find(
    (item) =>
      item.productType === 'QUANTITY' &&
      item.variants.some((variant) => variant.salePriceVnd !== null),
  );
  const variant = product?.variants.find((item) => item.salePriceVnd !== null);
  if (!product || !variant)
    throw new Error('The E2E store needs one active quantity product with a price.');
  return { product, variant };
}

export async function createTimedDineInOrder(page: Page) {
  const [table, item] = await Promise.all([availableTimedTable(page), sellableProduct(page)]);
  const result = await api<OpenOrderResult>(page, '/api/v1/pos/orders/open', {
    method: 'POST',
    data: {
      orderType: 'DINE_IN',
      tableId: table.id,
      expectedTableVersion: table.version,
      items: [
        {
          productId: item.product.productId,
          variantId: item.variant.id,
          quantityMilli: 1000,
          note: 'Playwright E2E fixture',
        },
      ],
    },
  });
  return { orderId: result.order.id, tableId: table.id, tableName: table.name };
}

export async function quote(page: Page, orderId: string) {
  return api<OrderQuote>(page, `/api/v1/pos/orders/${orderId}/quote`);
}

export async function updateOrderNote(
  page: Page,
  orderId: string,
  expectedOrderVersion: number,
  note: string,
) {
  return api<{ orderId: string }>(page, `/api/v1/pos/orders/${orderId}/note`, {
    method: 'PATCH',
    data: { expectedOrderVersion, note },
  });
}

export async function cancelOrder(page: Page, orderId: string) {
  const current = await quote(page, orderId);
  if (current.order.status !== 'OPEN' && current.order.status !== 'PAYMENT_PENDING') return;
  await api(page, `/api/v1/pos/orders/${orderId}/cancel`, {
    method: 'POST',
    data: { expectedOrderVersion: current.order.version, reason: 'Playwright E2E cleanup' },
  });
}

export async function expectTableAvailable(page: Page, tableId: string) {
  await expect
    .poll(async () => {
      const tables = await api<PosTable[]>(page, '/api/v1/pos/tables');
      return tables.find((table) => table.id === tableId)?.status;
    })
    .toBe('AVAILABLE');
}

export async function activeOrderIds(page: Page) {
  const overview = await api<{ orders: Array<{ id: string }> }>(page, '/api/v1/pos/overview');
  return overview.orders.map((order) => order.id);
}
