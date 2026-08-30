import type {
  PosOverviewDelta,
  PosOverviewOrder,
  PosOverviewSnapshot,
  PosOverviewTable,
} from '@contracts/pos';

export interface OverviewDeltaMergeResult {
  complete: boolean;
  snapshot: PosOverviewSnapshot | undefined;
}

function mergeTables(current: PosOverviewTable[], incoming: PosOverviewTable[]) {
  const byId = new Map(current.map((table) => [table.id, table]));
  for (const table of incoming) {
    const existing = byId.get(table.id);
    if (!existing || table.version >= existing.version) byId.set(table.id, table);
  }
  return current.map((table) => byId.get(table.id) ?? table);
}

function mergeOrder(current: PosOverviewOrder[], incoming: PosOverviewOrder) {
  const index = current.findIndex((order) => order.id === incoming.id);
  if (index < 0) return [...current, incoming];
  return current.map((order, orderIndex) =>
    orderIndex === index && incoming.version >= order.version ? incoming : order,
  );
}

export function mergePosOverviewDelta(
  current: PosOverviewSnapshot | undefined,
  delta: PosOverviewDelta,
): OverviewDeltaMergeResult {
  if (!current) return { complete: false, snapshot: current };
  const existingOrder = delta.order
    ? current.orders.find((order) => order.id === delta.order!.id)
    : undefined;
  if (
    delta.order &&
    existingOrder &&
    (delta.order.version < existingOrder.version || delta.order.version > existingOrder.version + 1)
  ) {
    return { complete: false, snapshot: current };
  }

  const tables = delta.tables ? mergeTables(current.tables, delta.tables) : current.tables;
  let orders = current.orders;
  if (delta.closedOrderId) orders = orders.filter((order) => order.id !== delta.closedOrderId);
  if (delta.order) orders = mergeOrder(orders, delta.order);
  return {
    complete: true,
    snapshot: { tables, orders, serverNowMs: delta.serverNowMs },
  };
}
