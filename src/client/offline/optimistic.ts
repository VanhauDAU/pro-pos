import type { PosOverviewOrder, PosOverviewSnapshot, PosOverviewTable } from '@contracts/pos';

export interface OptimisticLineItem {
  id: string;
  productId: string;
  variantId: string | null;
  productType: 'QUANTITY' | 'WEIGHT';
  productName: string;
  variantName: string | null;
  unitName: string | null;
  unitPriceVnd: number;
  quantityMilli: number;
  note: string | null;
  discountType: 'FIXED' | 'PERCENT' | null;
  discountInputValue: number | null;
  discountReason: string | null;
  grossLineTotalVnd: number;
  discountAmountVnd: number;
  netLineTotalVnd: number;
  priceVariantCount?: number;
}

export function calculateLineTotal(unitPriceVnd: number, quantityMilli: number): number {
  return Math.round((unitPriceVnd * quantityMilli) / 1000);
}

export function calculateDiscountAmount(
  grossAmount: number,
  type: 'FIXED' | 'PERCENT' | null | undefined,
  value: number | null | undefined,
): number {
  if (!type || !value || value <= 0) return 0;
  if (type === 'PERCENT') {
    return Math.min(grossAmount, Math.round((grossAmount * Math.min(100, value)) / 100));
  }
  return Math.min(grossAmount, Math.round(value));
}

export function updateTableInOverview(
  current: PosOverviewSnapshot | undefined,
  tableId: string | null | undefined,
  patch: Partial<PosOverviewTable>,
): PosOverviewSnapshot | undefined {
  if (!current || !tableId) return current;
  return {
    ...current,
    tables: current.tables.map((table) =>
      table.id === tableId ? { ...table, ...patch } : table,
    ),
  };
}

export function removeOrderFromOverview(
  current: PosOverviewSnapshot | undefined,
  orderId: string,
  tableId?: string | null,
): PosOverviewSnapshot | undefined {
  if (!current) return current;
  return {
    ...current,
    tables: tableId
      ? current.tables.map((table) =>
          table.id === tableId
            ? {
                ...table,
                status: 'AVAILABLE',
                activeOrderId: null,
                totalVnd: 0,
                itemCount: 0,
                guestCount: 0,
                occupiedSince: null,
                timeSessionStatus: null,
              }
            : table,
        )
      : current.tables,
    orders: current.orders.filter((order) => order.id !== orderId),
  };
}

export function upsertOrderInOverview(
  current: PosOverviewSnapshot | undefined,
  order: PosOverviewOrder,
  tablePatch?: { tableId: string; patch: Partial<PosOverviewTable> },
): PosOverviewSnapshot | undefined {
  if (!current) return current;
  const orderIndex = current.orders.findIndex((item) => item.id === order.id);
  const nextOrders =
    orderIndex < 0
      ? [...current.orders, order]
      : current.orders.map((item, index) => (index === orderIndex ? { ...item, ...order } : item));

  const nextTables = tablePatch
    ? current.tables.map((table) =>
        table.id === tablePatch.tableId ? { ...table, ...tablePatch.patch } : table,
      )
    : current.tables;

  return {
    ...current,
    tables: nextTables,
    orders: nextOrders,
    serverNowMs: Date.now(),
  };
}

export interface BuildOptimisticOpenParams {
  clientOrderId: string;
  orderType: 'DINE_IN' | 'TAKEAWAY';
  table: PosOverviewTable | null;
  draftLines: Array<{
    id: string;
    product: {
      productId: string;
      productName: string;
      productType?: 'QUANTITY' | 'WEIGHT';
      unitName?: string | null;
    };
    variant: {
      id: string;
      name?: string | null;
      salePriceVnd?: number | null;
    };
    quantityMilli: number;
    note?: string | null;
    discountType?: 'FIXED' | 'PERCENT' | null;
    discountInputValue?: number | null;
    discountReason?: string | null;
  }>;
  orderNote?: string | null;
  guestCount?: number;
  customerName?: string | null;
  customerPhone?: string | null;
  customerId?: string | null;
  openedByName?: string | null;
}

export function buildOptimisticOpenSnapshot(params: BuildOptimisticOpenParams) {
  const now = Date.now();
  let subtotalVnd = 0;
  let discountTotalVnd = 0;

  const items = params.draftLines.map((line) => {
    const unitPriceVnd = line.variant.salePriceVnd ?? 0;
    const grossLineTotalVnd = calculateLineTotal(unitPriceVnd, line.quantityMilli);
    const discountAmountVnd = calculateDiscountAmount(
      grossLineTotalVnd,
      line.discountType,
      line.discountInputValue,
    );
    const netLineTotalVnd = grossLineTotalVnd - discountAmountVnd;
    subtotalVnd += grossLineTotalVnd;
    discountTotalVnd += discountAmountVnd;

    return {
      id: line.id || crypto.randomUUID(),
      productId: line.product.productId,
      variantId: line.variant.id,
      productType: (line.product.productType ?? 'QUANTITY') as 'QUANTITY' | 'WEIGHT',
      productName: line.product.productName,
      variantName: line.variant.name ?? null,
      priceVariantCount: 1,
      unitName: line.product.unitName ?? null,
      unitPriceVnd,
      quantityMilli: line.quantityMilli,
      note: line.note ?? null,
      discountType: line.discountType ?? null,
      discountInputValue: line.discountInputValue ?? null,
      discountReason: line.discountReason ?? null,
      grossLineTotalVnd,
      discountAmountVnd,
      netLineTotalVnd,
    };
  });

  const totalVnd = subtotalVnd - discountTotalVnd;
  const displayCode = `HD-${params.clientOrderId.slice(0, 8).toUpperCase()}`;

  const quote = {
    order: {
      id: params.clientOrderId,
      displayCode,
      orderType: params.orderType,
      tableId: params.table?.id ?? null,
      tableName: params.table?.name ?? null,
      areaName: params.table?.areaName ?? null,
      version: 1,
      openedAt: now,
      openedByName: params.openedByName ?? null,
      status: 'OPEN' as const,
      note: params.orderNote ?? null,
      guestCount: params.guestCount ?? 1,
      customerName: params.customerName ?? null,
      customerPhone: params.customerPhone ?? null,
      customerId: params.customerId ?? null,
      hasCallHistory: false,
    },
    items,
    time: null,
    subtotalVnd,
    discountTotalVnd,
    itemDiscountTotalVnd: discountTotalVnd,
    promotionDiscountVnd: 0,
    promotions: [],
    promotion: null,
    promotionOptions: [],
    totalVnd,
    bankAccounts: [],
  };

  const tableSummaries: PosOverviewTable[] = params.table
    ? [
        {
          ...params.table,
          status: 'OCCUPIED',
          activeOrderId: params.clientOrderId,
          itemCount: items.reduce((sum, item) => sum + item.quantityMilli / 1000, 0),
          totalVnd,
          occupiedSince: now,
        },
      ]
    : [];

  return {
    clientMutationId: crypto.randomUUID(),
    quote,
    order: quote.order,
    items,
    totals: {
      subtotalVnd,
      discountTotalVnd,
      totalVnd,
    },
    tableSummaries,
    serverNowMs: now,
  };
}

export interface BuildOptimisticSaveParams {
  currentQuote: {
    order: {
      id: string;
      displayCode?: string | null;
      orderType: 'DINE_IN' | 'TAKEAWAY';
      tableId?: string | null;
      tableName?: string | null;
      areaName?: string | null;
      version: number;
      openedAt: number;
      openedByName?: string | null;
      status: 'OPEN' | 'PAYMENT_PENDING';
      note?: string | null;
      guestCount?: number;
      customerName?: string | null;
      customerPhone?: string | null;
      customerId?: string | null;
      hasCallHistory?: boolean;
    };
    items: Array<any>;
    time?: any;
    totalVnd: number;
    subtotalVnd?: number;
    discountTotalVnd?: number;
    [key: string]: any;
  };
  draftLines: Array<{
    id: string;
    product: {
      productId: string;
      productName: string;
      productType?: 'QUANTITY' | 'WEIGHT';
      unitName?: string | null;
    };
    variant: {
      id: string;
      name?: string | null;
      salePriceVnd?: number | null;
    };
    quantityMilli: number;
    note?: string | null;
    discountType?: 'FIXED' | 'PERCENT' | null;
    discountInputValue?: number | null;
    discountReason?: string | null;
  }>;
  updatedItems?: Array<{
    id?: string;
    itemId?: string;
    quantityMilli?: number;
    note?: string | null;
    discount?: null | { type: 'FIXED' | 'PERCENT'; value: number; reason: string };
    [key: string]: unknown;
  }>;
  note?: string | null;
  tableSummaries?: PosOverviewTable[];
}

export function buildOptimisticSaveSnapshot(params: BuildOptimisticSaveParams) {
  const now = Date.now();
  const updateMap = new Map(
    (params.updatedItems ?? []).map((it) => [it.id ?? it.itemId ?? '', it]),
  );

  const updatedExistingItems = params.currentQuote.items
    .filter((it) => {
      const edit = updateMap.get(it.id);
      return !edit || edit.quantityMilli === undefined || edit.quantityMilli > 0;
    })
    .map((it) => {
      const edit = updateMap.get(it.id);
      if (!edit) return it;
      const quantityMilli = edit.quantityMilli ?? it.quantityMilli;
      const note = edit.note !== undefined ? edit.note : it.note;
      let discountType = it.discountType;
      let discountInputValue = it.discountInputValue;
      let discountReason = it.discountReason;
      if (edit.discount !== undefined) {
        discountType = edit.discount?.type ?? null;
        discountInputValue = edit.discount?.value ?? null;
        discountReason = edit.discount?.reason ?? null;
      }
      const grossLineTotalVnd = calculateLineTotal(it.unitPriceVnd, quantityMilli);
      const discountAmountVnd = calculateDiscountAmount(
        grossLineTotalVnd,
        discountType,
        discountInputValue,
      );
      const netLineTotalVnd = grossLineTotalVnd - discountAmountVnd;
      return {
        ...it,
        quantityMilli,
        note,
        discountType,
        discountInputValue,
        discountReason,
        grossLineTotalVnd,
        discountAmountVnd,
        netLineTotalVnd,
      };
    });

  const newLines = params.draftLines.map((line) => {
    const unitPriceVnd = line.variant.salePriceVnd ?? 0;
    const grossLineTotalVnd = calculateLineTotal(unitPriceVnd, line.quantityMilli);
    const discountAmountVnd = calculateDiscountAmount(
      grossLineTotalVnd,
      line.discountType,
      line.discountInputValue,
    );
    const netLineTotalVnd = grossLineTotalVnd - discountAmountVnd;
    return {
      id: line.id || crypto.randomUUID(),
      productId: line.product.productId,
      variantId: line.variant.id,
      productType: (line.product.productType ?? 'QUANTITY') as 'QUANTITY' | 'WEIGHT',
      productName: line.product.productName,
      variantName: line.variant.name ?? null,
      priceVariantCount: 1,
      unitName: line.product.unitName ?? null,
      unitPriceVnd,
      quantityMilli: line.quantityMilli,
      note: line.note ?? null,
      discountType: line.discountType ?? null,
      discountInputValue: line.discountInputValue ?? null,
      discountReason: line.discountReason ?? null,
      grossLineTotalVnd,
      discountAmountVnd,
      netLineTotalVnd,
    };
  });

  const allItems = [...updatedExistingItems, ...newLines];
  let subtotalVnd = 0;
  let itemDiscountTotalVnd = 0;
  for (const item of allItems) {
    subtotalVnd += item.grossLineTotalVnd;
    itemDiscountTotalVnd += item.discountAmountVnd;
  }

  const timeAmount = params.currentQuote.time?.amountAfterRoundingVnd ?? 0;
  const totalVnd = subtotalVnd - itemDiscountTotalVnd + timeAmount;

  const quote = {
    ...params.currentQuote,
    order: {
      ...params.currentQuote.order,
      version: params.currentQuote.order.version + 1,
      note: params.note !== undefined ? params.note : params.currentQuote.order.note,
    },
    items: allItems,
    subtotalVnd,
    discountTotalVnd: itemDiscountTotalVnd,
    itemDiscountTotalVnd,
    totalVnd,
  };

  const tableSummaries = (params.tableSummaries ?? []).map((t) =>
    t.id === quote.order.tableId
      ? {
          ...t,
          itemCount: allItems.reduce((sum, it) => sum + it.quantityMilli / 1000, 0),
          totalVnd,
        }
      : t,
  );

  return {
    clientMutationId: crypto.randomUUID(),
    quote,
    order: quote.order,
    items: allItems,
    totals: {
      subtotalVnd,
      discountTotalVnd: itemDiscountTotalVnd,
      totalVnd,
    },
    tableSummaries,
    serverNowMs: now,
  };
}

export function buildOptimisticOverviewForOpenOrder(
  current: PosOverviewSnapshot | undefined,
  snapshot: {
    order: {
      id: string;
      displayCode?: string | null;
      orderType: 'DINE_IN' | 'TAKEAWAY';
      status: 'OPEN' | 'PAYMENT_PENDING';
      version: number;
      openedAt: number;
      tableId?: string | null;
      tableName?: string | null;
      areaName?: string | null;
    };
    quote: {
      totalVnd: number;
      items: Array<{ quantityMilli: number }>;
      time?: { status?: string | null } | null;
    };
    tableSummaries: PosOverviewTable[];
  },
): PosOverviewSnapshot | undefined {
  if (!current) return current;
  const itemCount = snapshot.quote.items.reduce((s, it) => s + it.quantityMilli / 1000, 0);
  const overviewOrder: PosOverviewOrder = {
    id: snapshot.order.id,
    displayCode: snapshot.order.displayCode ?? '',
    orderType: snapshot.order.orderType,
    status: snapshot.order.status,
    version: snapshot.order.version,
    openedAt: snapshot.order.openedAt,
    itemCount,
    totalVnd: snapshot.quote.totalVnd,
    tableId: snapshot.order.tableId ?? null,
    tableName: snapshot.order.tableName ?? null,
    areaName: snapshot.order.areaName ?? null,
    timeStatus: (snapshot.quote.time?.status as any) ?? null,
  };
  const table = snapshot.tableSummaries[0];
  return upsertOrderInOverview(
    current,
    overviewOrder,
    table ? { tableId: table.id, patch: table } : undefined,
  );
}

export function buildOptimisticOverviewForSaveOrder(
  current: PosOverviewSnapshot | undefined,
  orderId: string,
  quote: {
    totalVnd: number;
    items: Array<{ quantityMilli: number }>;
    time?: { status?: string | null } | null;
  },
  tablePatch?: { tableId: string; patch: Partial<PosOverviewTable> },
): PosOverviewSnapshot | undefined {
  if (!current) return current;
  const existingOrder = current.orders.find((o) => o.id === orderId);
  if (!existingOrder) return current;
  const itemCount = quote.items.reduce((s, it) => s + it.quantityMilli / 1000, 0);
  const updatedOrder: PosOverviewOrder = {
    ...existingOrder,
    totalVnd: quote.totalVnd,
    itemCount,
    timeStatus: (quote.time?.status as any) ?? existingOrder.timeStatus,
  };
  return upsertOrderInOverview(current, updatedOrder, tablePatch);
}
