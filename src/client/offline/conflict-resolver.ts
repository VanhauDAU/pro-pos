import type { PosCommandBaseQuote, PosQueuedCommand } from './types';

export type ConflictResolution =
  | { action: 'ACKNOWLEDGE'; reason: string }
  | { action: 'REBASE'; body: Record<string, unknown>; reason: string }
  | {
      action: 'CONFLICT';
      conflictType: 'BUSINESS_CONFLICT' | 'TERMINAL_CONFLICT' | 'OPEN_TABLE_CONFLICT';
      reason: string;
    };

function sameItem(
  left: PosCommandBaseQuote['items'][number] | undefined,
  right: PosCommandBaseQuote['items'][number] | undefined,
) {
  if (!left || !right) return left === right;
  return (
    left.quantityMilli === right.quantityMilli &&
    (left.variantId ?? null) === (right.variantId ?? null) &&
    (left.unitPriceVnd ?? null) === (right.unitPriceVnd ?? null) &&
    (left.note ?? null) === (right.note ?? null) &&
    (left.discountType ?? null) === (right.discountType ?? null) &&
    (left.discountInputValue ?? null) === (right.discountInputValue ?? null) &&
    (left.discountReason ?? null) === (right.discountReason ?? null)
  );
}

function sameTime(left: PosCommandBaseQuote['time'], right: PosCommandBaseQuote['time']) {
  if (!left || !right) return left === right;
  return (
    left.status === right.status &&
    left.startedAtMs === right.startedAtMs &&
    left.endedAtMs === right.endedAtMs
  );
}

function expectedVersionBody(command: PosQueuedCommand, latest: PosCommandBaseQuote) {
  return { ...command.body, expectedOrderVersion: latest.order.version };
}

function resolveSave(command: PosQueuedCommand, latest: PosCommandBaseQuote): ConflictResolution {
  const base = command.baseQuote;
  if (!base) {
    return {
      action: 'CONFLICT',
      conflictType: 'BUSINESS_CONFLICT',
      reason: 'Thiếu snapshot gốc để đối chiếu thay đổi đơn.',
    };
  }
  const updates = Array.isArray(command.body.updatedItems)
    ? (command.body.updatedItems as Array<{ itemId?: unknown }>)
    : [];
  for (const update of updates) {
    if (typeof update.itemId !== 'string') continue;
    const baseItem = base.items.find((item) => item.id === update.itemId);
    const latestItem = latest.items.find((item) => item.id === update.itemId);
    if (!sameItem(baseItem, latestItem)) {
      return {
        action: 'CONFLICT',
        conflictType: latestItem ? 'BUSINESS_CONFLICT' : 'TERMINAL_CONFLICT',
        reason: latestItem
          ? 'Cùng một món đã được sửa trên thiết bị khác.'
          : 'Món cần sửa không còn tồn tại trên đơn máy chủ.',
      };
    }
  }
  if (
    Object.hasOwn(command.body, 'note') &&
    (base.order.note ?? null) !== (latest.order.note ?? null) &&
    command.body.note !== latest.order.note
  ) {
    return {
      action: 'CONFLICT',
      conflictType: 'BUSINESS_CONFLICT',
      reason: 'Ghi chú đơn đã được sửa trên thiết bị khác.',
    };
  }
  if (Object.hasOwn(command.body, 'guest')) {
    const baseGuest = JSON.stringify([
      base.order.guestCount ?? 1,
      base.order.customerId ?? null,
      base.order.customerName ?? null,
      base.order.customerPhone ?? null,
    ]);
    const latestGuest = JSON.stringify([
      latest.order.guestCount ?? 1,
      latest.order.customerId ?? null,
      latest.order.customerName ?? null,
      latest.order.customerPhone ?? null,
    ]);
    if (baseGuest !== latestGuest) {
      return {
        action: 'CONFLICT',
        conflictType: 'BUSINESS_CONFLICT',
        reason: 'Thông tin khách hàng đã được sửa trên thiết bị khác.',
      };
    }
  }
  if (Object.hasOwn(command.body, 'promotionIds')) {
    const basePromotions = (base.promotions ?? []).map((promotion) => promotion.id).toSorted();
    const latestPromotions = (latest.promotions ?? []).map((promotion) => promotion.id).toSorted();
    if (JSON.stringify(basePromotions) !== JSON.stringify(latestPromotions)) {
      return {
        action: 'CONFLICT',
        conflictType: 'BUSINESS_CONFLICT',
        reason: 'Khuyến mại của đơn đã được thay đổi trên thiết bị khác.',
      };
    }
  }
  return {
    action: 'REBASE',
    body: expectedVersionBody(command, latest),
    reason: 'Các intent trong đợt lưu không đụng vào dữ liệu vừa thay đổi.',
  };
}

export function resolvePosVersionConflict(
  command: PosQueuedCommand,
  latest: PosCommandBaseQuote,
): ConflictResolution {
  if (latest.order.status === 'PAID' || latest.order.status === 'CANCELLED') {
    return {
      action: 'CONFLICT',
      conflictType: 'TERMINAL_CONFLICT',
      reason:
        latest.order.status === 'PAID'
          ? 'Đơn đã được thanh toán trên thiết bị khác.'
          : 'Đơn đã bị hủy trên thiết bị khác.',
    };
  }

  if (command.type === 'OPEN_ORDER') {
    return {
      action: 'CONFLICT',
      conflictType: 'OPEN_TABLE_CONFLICT',
      reason: 'Bàn đã được mở trên thiết bị khác.',
    };
  }
  if (command.type === 'SAVE_ORDER') return resolveSave(command, latest);

  if (command.type === 'CASH_CHECKOUT') {
    const expectedTotal = command.body.expectedTotalVnd;
    if (typeof expectedTotal !== 'number' || latest.totalVnd !== expectedTotal) {
      return {
        action: 'CONFLICT',
        conflictType: 'BUSINESS_CONFLICT',
        reason: `Tổng trên thiết bị là ${Number(expectedTotal ?? 0)} nhưng tổng máy chủ là ${Number(latest.totalVnd ?? 0)}.`,
      };
    }
    return {
      action: 'CONFLICT',
      conflictType: 'BUSINESS_CONFLICT',
      reason: 'Đơn đã thay đổi sau khi ghi nhận thanh toán tiền mặt.',
    };
  }

  if (command.type === 'CANCEL_ORDER') {
    return {
      action: 'CONFLICT',
      conflictType: 'BUSINESS_CONFLICT',
      reason: 'Đơn đã thay đổi trước khi lệnh hủy được đồng bộ.',
    };
  }

  const base = command.baseQuote;
  if (!base) {
    return {
      action: 'CONFLICT',
      conflictType: 'BUSINESS_CONFLICT',
      reason: 'Thiếu snapshot gốc để rebase an toàn.',
    };
  }

  if (command.type === 'UPDATE_NOTE') {
    if ((base.order.note ?? null) !== (latest.order.note ?? null)) {
      return {
        action: 'CONFLICT',
        conflictType: 'BUSINESS_CONFLICT',
        reason: 'Ghi chú đơn đã được sửa trên thiết bị khác.',
      };
    }
    return {
      action: 'REBASE',
      body: expectedVersionBody(command, latest),
      reason: 'Ghi chú chưa bị đổi.',
    };
  }

  if (
    command.type === 'PAUSE_TIME' ||
    command.type === 'RESUME_TIME' ||
    command.type === 'UPDATE_TIME_RANGE' ||
    command.type === 'REMOVE_TIME' ||
    command.type === 'STOP_TIME'
  ) {
    if (!sameTime(base.time, latest.time)) {
      return {
        action: 'CONFLICT',
        conflictType: 'BUSINESS_CONFLICT',
        reason: 'Phiên tính giờ đã được chỉnh trên thiết bị khác.',
      };
    }
    return {
      action: 'REBASE',
      body: expectedVersionBody(command, latest),
      reason: 'Phiên tính giờ không đổi; chỉ version của đơn đã tăng.',
    };
  }

  return {
    action: 'CONFLICT',
    conflictType: 'BUSINESS_CONFLICT',
    reason: 'Không có quy tắc rebase an toàn cho thao tác này.',
  };
}
