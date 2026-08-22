import type { PricingConfigSnapshot } from '@domain/pricing/types';

export type OrderDetailStatus = 'OPEN' | 'PAYMENT_PENDING' | 'PAID' | 'CANCELLED';
export type OrderDetailType = 'DINE_IN' | 'TAKEAWAY';
export type OrderDetailPaymentMethod = 'CASH' | 'BANK_TRANSFER';
export type OrderDetailPaymentStatus = 'SUCCEEDED' | 'PENDING' | 'VOIDED';

export interface OrderDetailInfo {
  id: string;
  displayCode: string;
  orderType: OrderDetailType;
  status: OrderDetailStatus;
  version: number;
  storeId: string;
  storeName: string;
  tableId: string | null;
  tableName: string | null;
  areaId: string | null;
  areaName: string | null;
  tableUsageChain: string[];
  openedAt: number;
  openedById: string;
  openedByName: string;
  closedAt: number | null;
  cancelledAt: number | null;
  cancelReason: string | null;
  cancelledByName: string | null;
  note: string | null;
}

export interface OrderCustomerInfo {
  name: string;
  phone: string | null;
}

export interface OrderTimeSummary {
  totalElapsedSeconds: number;
  totalAmountBeforeRoundingVnd: number;
  totalAmountAfterRoundingVnd: number;
  isRealtime: boolean;
  status: 'RUNNING' | 'PAUSED' | 'ENDED';
}

export interface OrderTimeSegmentDetail {
  id: string;
  tableId: string;
  tableName: string;
  areaName: string | null;
  timeProductId: string;
  rateNameSnapshot: string;
  startedAt: number;
  endedAt: number | null;
  elapsedSeconds: number;
  unitPriceSnapshot: number;
  billingUnit: string;
  amountBeforeRoundingVnd: number;
  amountAfterRoundingVnd: number;
  pricingRuleSnapshot: PricingConfigSnapshot | null;
  isCurrentActive: boolean;
}

export interface OrderTableTransferDetail {
  id: string;
  fromTableId: string;
  fromTableName: string;
  toTableId: string;
  toTableName: string;
  transferredAt: number;
  employeeId: string;
  employeeName: string;
  oldRateVnd: number;
  newRateVnd: number;
  reason: string | null;
}

export interface OrderRateChangeDetail {
  id: string;
  tableName: string;
  oldRateVnd: number;
  newRateVnd: number;
  appliedAt: number;
  employeeName: string;
  reason: string | null;
}

export interface OrderItemDetail {
  id: string;
  productId: string;
  variantId: string | null;
  productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
  productNameSnapshot: string;
  variantNameSnapshot: string | null;
  unitNameSnapshot: string | null;
  unitPriceSnapshot: number;
  quantityMilli: number;
  grossLineTotalVnd: number;
  discountType: 'FIXED' | 'PERCENT' | null;
  discountInputValue: number | null;
  discountAmountVnd: number;
  discountReason: string | null;
  netLineTotalVnd: number;
  note: string | null;
  addedById: string | null;
  addedByName: string | null;
  addedAt: number | null;
  timeStartedAtMs: number | null;
  timeEndedAtMs: number | null;
  avatarType?: 'COLOR' | 'IMAGE' | null;
  avatarColor?: string | null;
  mediaId?: string | null;
}

export interface OrderCheckoutSnapshotDetail {
  stoppedAt: number | null;
  status: string | null;
  frozenElapsedSeconds: number | null;
  frozenTimeAmountVnd: number | null;
  frozenItemsAmountVnd: number | null;
  frozenTotalVnd: number | null;
  stoppedByName: string | null;
  resumedAt: number | null;
  resumedByName: string | null;
}

export interface OrderPaymentDetail {
  id: string;
  method: OrderDetailPaymentMethod;
  status: OrderDetailPaymentStatus;
  amount: number;
  cashReceived: number | null;
  cashChange: number | null;
  transactionRef: string | null;
  createdById: string;
  createdByName: string;
  createdAt: number;
}

export interface OrderPaymentAllocationDetail {
  id: string;
  method: 'CASH' | 'BANK_TRANSFER' | 'DEBT';
  amountVnd: number;
  tenderedVnd: number | null;
  createdAt: number;
}

export interface OrderInvoiceDetail {
  id: string;
  displayCode: string;
  status: 'COMPLETED' | 'CANCELLED';
  issuedAt: number;
  issuedById: string;
  issuedByName: string;
  subtotalVnd: number;
  discountTotalVnd: number;
  totalVnd: number;
  snapshotJson: string;
}

export interface OrderAuditEventDetail {
  id: string;
  action: string;
  title: string;
  description: string;
  eventAt: number;
  actorId: string | null;
  actorName: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
}

export interface OrderTotalsDetail {
  timeAmountVnd: number;
  itemGrossAmountVnd: number;
  itemDiscountAmountVnd: number;
  orderDiscountAmountVnd: number;
  subtotalVnd: number;
  totalDiscountVnd: number;
  totalVnd: number;
  paidAmountVnd: number;
  changeAmountVnd: number;
  debtAmountVnd: number;
}

export interface OrderDetailDto {
  order: OrderDetailInfo;
  customer: OrderCustomerInfo | null;
  timeSummary: OrderTimeSummary | null;
  timeSegments: OrderTimeSegmentDetail[];
  tableTransfers: OrderTableTransferDetail[];
  rateChanges: OrderRateChangeDetail[];
  items: OrderItemDetail[];
  checkout: OrderCheckoutSnapshotDetail | null;
  payments: OrderPaymentDetail[];
  paymentAllocations: OrderPaymentAllocationDetail[];
  invoice: OrderInvoiceDetail | null;
  auditEvents: OrderAuditEventDetail[];
  totals: OrderTotalsDetail;
}
