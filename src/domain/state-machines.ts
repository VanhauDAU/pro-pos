import type { OrderStatus, TableStatus, TimeSessionStatus } from '@contracts/domain';

const orderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  OPEN: ['PAYMENT_PENDING', 'CANCELLED'],
  PAYMENT_PENDING: ['OPEN', 'PAID', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
};

const tableTransitions: Record<TableStatus, readonly TableStatus[]> = {
  AVAILABLE: ['OCCUPIED', 'DISABLED'],
  OCCUPIED: ['AVAILABLE'],
  DISABLED: ['AVAILABLE'],
};

const timeSessionTransitions: Record<TimeSessionStatus, readonly TimeSessionStatus[]> = {
  RUNNING: ['PAUSED', 'ENDED'],
  PAUSED: ['RUNNING', 'ENDED'],
  ENDED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus) {
  return orderTransitions[from].includes(to);
}

export function canTransitionTable(from: TableStatus, to: TableStatus) {
  return tableTransitions[from].includes(to);
}

export function canTransitionTimeSession(from: TimeSessionStatus, to: TimeSessionStatus) {
  return timeSessionTransitions[from].includes(to);
}
