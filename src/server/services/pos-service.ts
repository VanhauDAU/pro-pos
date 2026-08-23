import type { PricingConfigSnapshot, PricingResult, PricingSegment } from '@domain/pricing/types';
import type {
  OrderDetailDto,
  OrderTimeSegmentDetail,
  OrderTableTransferDetail,
  OrderRateChangeDetail,
  OrderItemDetail,
  OrderAppliedPromotionDetail,
  OrderAuditEventDetail,
} from '@contracts/order-detail';
import { calculateTimePrice } from '@domain/pricing/engine';
import { AppError } from '@server/lib/app-error';
import { PosRepository } from '@server/repositories/pos-repository';
import { AuditRepository } from '@server/repositories/audit-repository';
import { AuthorizationRepository } from '@server/repositories/authorization-repository';
import { CustomerService } from '@server/services/customer-service';
import { PromotionService } from '@server/services/promotion-service';
import { PromotionRepository } from '@server/repositories/promotion-repository';

function checkedMoneyFromMilli(unitPriceVnd: number, quantityMilli: number) {
  const amount = (BigInt(unitPriceVnd) * BigInt(quantityMilli) + 500n) / 1000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError('LINE_TOTAL_TOO_LARGE', 'Giá trị mặt hàng vượt giới hạn.', 422);
  }
  return Number(amount);
}

function checkedPercentAmount(amountVnd: number, percent: number) {
  return Number((BigInt(amountVnd) * BigInt(percent) + 50n) / 100n);
}

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('TABLE_NOT_AVAILABLE')) {
    throw new AppError('TABLE_NOT_AVAILABLE', 'Bàn không còn trống hoặc đã thay đổi.', 409);
  }
  if (message.includes('ORDER_VERSION_CONFLICT')) {
    throw new AppError('ORDER_VERSION_CONFLICT', 'Đơn hàng đã thay đổi. Vui lòng tải lại.', 409);
  }
  if (message.includes('ORDER_NOT_PAYMENT_PENDING')) {
    throw new AppError(
      'ORDER_NOT_PAYMENT_PENDING',
      'Đơn hàng không ở trạng thái chờ thanh toán.',
      409,
    );
  }
  if (message.includes('ORDER_NOT_OPEN')) {
    throw new AppError('ORDER_NOT_OPEN', 'Đơn hàng không ở trạng thái mở.', 409);
  }
  if (message.includes('ORDER_ALREADY_PAID')) {
    throw new AppError('ORDER_ALREADY_PAID', 'Đơn hàng đã được thanh toán.', 409);
  }
  if (message.includes('TABLE_TRANSFER_CONFLICT')) {
    throw new AppError(
      'TABLE_TRANSFER_CONFLICT',
      'Không thể chuyển bàn do trạng thái đã thay đổi.',
      409,
    );
  }
  if (message.includes('INSUFFICIENT_CASH')) {
    throw new AppError('INSUFFICIENT_CASH', 'Tiền khách đưa không đủ.', 422);
  }
  if (message.includes('TIME_NOT_RUNNING')) {
    throw new AppError('TIME_NOT_RUNNING', 'Phiên thời gian không ở trạng thái đang chạy.', 409);
  }
  if (message.includes('TIME_NOT_PAUSED')) {
    throw new AppError('TIME_NOT_PAUSED', 'Phiên thời gian không ở trạng thái tạm dừng.', 409);
  }
  if (message.includes('DISCOUNT_INVALID')) {
    throw new AppError('DISCOUNT_INVALID', 'Giảm giá không hợp lệ.', 422);
  }
  if (message.includes('UNIQUE constraint failed')) {
    throw new AppError('CONFLICT', 'Dữ liệu đã được xử lý trước đó.', 409);
  }
  throw error;
}

export class PosService {
  private readonly repository: PosRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new PosRepository(env.DB);
  }

  private async businessDay(storeId: string, now: number) {
    const numbering = await this.repository.findInvoiceNumberingSettings(storeId);
    if (!numbering) throw new AppError('STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.', 404);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: numbering.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date(now - numbering.cutoffMinutes * 60_000))
      .replaceAll('-', '');
  }

  async listTables(storeId: string) {
    const result = await this.repository.listTables(storeId);
    return result.results;
  }

  async listOrders(storeId: string, now = Date.now()) {
    const result = await this.repository.listActiveOrders(storeId);
    return Promise.all(
      result.results.map(async (order) => {
        const quote = await this.quote(storeId, order.id, now);
        return {
          id: order.id,
          displayCode: order.display_code,
          orderType: order.order_type,
          status: order.status,
          version: order.version,
          openedAt: order.opened_at,
          tableId: order.table_id,
          tableName: order.table_name,
          areaId: order.area_id,
          areaName: order.area_name,
          itemCount: quote.items.reduce((sum, item) => sum + Number(item.quantityMilli) / 1000, 0),
          totalVnd: quote.totalVnd,
          timeStatus: quote.time?.status ?? null,
        };
      }),
    );
  }

  async createTakeaway(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    note: string | null;
  }) {
    const replay = await this.repository.findCreateTakeawayCommand(
      input.storeId,
      input.idempotencyKey,
    );
    if (replay) return replay;
    const orderId = crypto.randomUUID();
    const issuedAt = Date.now();
    const businessDay = await this.businessDay(input.storeId, issuedAt);
    await this.repository.createTakeawayOrder({
      commandId: input.idempotencyKey,
      storeId: input.storeId,
      orderId,
      businessDay,
      note: input.note,
      actorId: input.actorId,
      requestId: input.requestId,
      issuedAt,
    });
    return (await this.repository.findCreateTakeawayCommand(input.storeId, input.idempotencyKey))!;
  }

  async listCatalog(storeId: string) {
    const result = await this.repository.listSaleCatalog(storeId);
    const products = new Map<
      string,
      Omit<
        (typeof result.results)[number],
        'variantId' | 'variantName' | 'salePriceVnd' | 'promptPrice'
      > & {
        variants: Array<{
          id: string;
          name: string;
          salePriceVnd: number | null;
          promptPrice: 0 | 1;
        }>;
      }
    >();
    for (const row of result.results) {
      const product = products.get(row.productId) ?? {
        productId: row.productId,
        productName: row.productName,
        productType: row.productType,
        avatarType: row.avatarType,
        avatarColor: row.avatarColor,
        mediaId: row.mediaId,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        unitName: row.unitName,
        variants: [],
      };
      product.variants.push({
        id: row.variantId,
        name: row.variantName,
        salePriceVnd: row.salePriceVnd,
        promptPrice: row.promptPrice,
      });
      products.set(row.productId, product);
    }
    return [...products.values()];
  }

  async getStaffContext(storeId: string, actorId: string) {
    const context = await this.repository.getStaffContext(storeId, actorId);
    if (!context) return context;
    const permissions = await new AuthorizationRepository(this.env.DB).listUserPermissions(
      storeId,
      actorId,
    );
    const { posRealtimeEnabled, ...staffContext } = context;
    return {
      ...staffContext,
      permissions,
      capabilities: { posRealtime: posRealtimeEnabled === 1 },
    };
  }

  async productPricingSnapshot(
    storeId: string,
    productId: string,
  ): Promise<PricingConfigSnapshot | null> {
    const row = await this.repository.findProductPricing(storeId, productId);
    if (!row) return null;
    const windows = await this.repository.listSpecialWindows(storeId, row.config_id);
    return {
      version: row.pricing_version,
      timezone: this.env.STORE_TIMEZONE,
      basePriceVnd: row.base_price,
      baseDurationSeconds: row.base_duration_seconds,
      calculationMode: row.calculation_mode,
      roundingUnitVnd: row.rounding_unit,
      firstPeriod:
        row.first_period_enabled === 1 &&
        row.first_period_duration_seconds &&
        row.first_period_price
          ? {
              enabled: true,
              durationSeconds: row.first_period_duration_seconds,
              priceVnd: row.first_period_price,
            }
          : { enabled: false },
      specialWindows: windows.results,
    };
  }

  private async pricingSnapshot(storeId: string, tableId: string) {
    const row = await this.repository.findTablePricing(storeId, tableId);
    if (!row) throw new AppError('TABLE_PRICING_MISSING', 'Bàn chưa có bảng giá.', 422);
    const windows = await this.repository.listSpecialWindows(storeId, row.config_id);
    const config: PricingConfigSnapshot = {
      version: row.pricing_version,
      timezone: this.env.STORE_TIMEZONE,
      basePriceVnd: row.base_price,
      baseDurationSeconds: row.base_duration_seconds,
      calculationMode: row.calculation_mode,
      roundingUnitVnd: row.rounding_unit,
      firstPeriod:
        row.first_period_enabled === 1 &&
        row.first_period_duration_seconds &&
        row.first_period_price
          ? {
              enabled: true,
              durationSeconds: row.first_period_duration_seconds,
              priceVnd: row.first_period_price,
            }
          : { enabled: false },
      specialWindows: windows.results,
    };
    return { row, config };
  }

  async openTable(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    tableId: string;
    expectedTableVersion: number;
    actorSessionId?: string | null;
    deviceId?: string | null;
    now?: number;
  }) {
    const replay = await this.repository.findOpenCommand(input.storeId, input.idempotencyKey);
    if (replay) return replay;
    const pricing = await this.pricingSnapshot(input.storeId, input.tableId);
    if (pricing.row.table_status !== 'AVAILABLE') {
      throw new AppError('TABLE_NOT_AVAILABLE', 'Bàn không còn trống.', 409);
    }
    const orderId = crypto.randomUUID();
    const timeSessionId = crypto.randomUUID();
    const issuedAt = input.now ?? Date.now();
    const businessDay = await this.businessDay(input.storeId, issuedAt);
    try {
      await this.repository.executeOpenTable({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        tableId: input.tableId,
        expectedTableVersion: input.expectedTableVersion,
        orderId,
        timeSessionId,
        businessDay,
        pricingSnapshotJson: JSON.stringify(pricing.config),
        pricingVersion: pricing.config.version,
        actorId: input.actorId,
        requestId: input.requestId,
        issuedAt,
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    await new AuditRepository(this.env.DB).enrichByRequest(input.storeId, input.requestId, {
      actorUserId: input.actorId,
      actorSessionId: input.actorSessionId ?? null,
      deviceId: input.deviceId ?? null,
      requestId: input.requestId,
    });
    return (await this.repository.findOpenCommand(input.storeId, input.idempotencyKey))!;
  }

  async addItem(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    productId: string;
    variantId?: string | null;
    enteredUnitPriceVnd?: number;
    quantityMilli: number;
    timeStartedAtMs?: number | null | undefined;
    timeEndedAtMs?: number | null | undefined;
    note?: string | null;
    expectedOrderVersion: number;
    discount?: null | { type: 'FIXED' | 'PERCENT'; value: number; reason: string };
    actorSessionId?: string | null;
    deviceId?: string | null;
    now?: number;
  }) {
    const replay =
      (await this.repository.findAddItemCommand(input.storeId, input.idempotencyKey)) ??
      (await this.repository.findAddTakeawayItemCommand(input.storeId, input.idempotencyKey));
    if (replay) return replay;
    const now = input.now ?? Date.now();
    const takeawayOrder = await this.repository.findTakeawayOrder(input.storeId, input.orderId);
    const product = await this.repository.findSaleVariant(
      input.storeId,
      input.productId,
      input.variantId,
    );
    if (
      !product ||
      product.product_status !== 'ACTIVE' ||
      (product.product_type !== 'TIME' && product.variant_status !== 'ACTIVE') ||
      (product.prompt_price !== 1 && product.sale_price === null)
    ) {
      throw new AppError('PRODUCT_NOT_AVAILABLE', 'Mặt hàng không khả dụng.', 422);
    }
    if (product.product_type === 'QUANTITY' && input.quantityMilli % 1000 !== 0) {
      throw new AppError(
        'QUANTITY_MUST_BE_WHOLE',
        'Mặt hàng theo số lượng phải là số nguyên.',
        422,
      );
    }
    const effectiveStartedAt =
      product.product_type === 'TIME'
        ? (input.timeStartedAtMs ?? now)
        : (input.timeStartedAtMs ?? null);
    const effectiveEndedAt = product.product_type === 'TIME' ? (input.timeEndedAtMs ?? null) : null;

    if (product.product_type === 'TIME') {
      if (takeawayOrder) {
        throw new AppError(
          'TIME_ITEM_DINE_IN_ONLY',
          'Mặt hàng tính giờ chỉ dùng cho đơn tại chỗ.',
          422,
        );
      }
      if (
        effectiveStartedAt === null ||
        !Number.isInteger(effectiveStartedAt) ||
        (effectiveEndedAt !== null &&
          (!Number.isInteger(effectiveEndedAt) || effectiveEndedAt <= effectiveStartedAt))
      ) {
        throw new AppError(
          'TIME_RANGE_INVALID',
          'Giờ vào và giờ ra của mặt hàng tính giờ không hợp lệ.',
          422,
        );
      }
    }
    if (product.prompt_price === 1 && input.enteredUnitPriceVnd === undefined) {
      throw new AppError('ENTERED_UNIT_PRICE_REQUIRED', 'Mặt hàng yêu cầu nhập giá bán.', 422);
    }
    if (
      product.prompt_price === 1 &&
      (!Number.isInteger(input.enteredUnitPriceVnd) || input.enteredUnitPriceVnd! < 0)
    ) {
      throw new AppError('ENTERED_UNIT_PRICE_INVALID', 'Giá nhập khi bán không hợp lệ.', 422);
    }
    let unitPriceVnd =
      product.prompt_price === 1 ? input.enteredUnitPriceVnd! : product.sale_price!;
    let quantityMilli = input.quantityMilli;
    let subtotal = 0;

    if (product.product_type === 'TIME') {
      const pricingConfig = await this.productPricingSnapshot(input.storeId, product.product_id);
      if (pricingConfig) {
        unitPriceVnd = pricingConfig.basePriceVnd;
        const timeResult = calculateTimePrice({
          startedAtMs: effectiveStartedAt!,
          endedAtMs: Math.max(effectiveStartedAt! + 1000, effectiveEndedAt ?? now),
          config: pricingConfig,
        });
        quantityMilli = Math.max(1, Math.round((timeResult.elapsedSeconds / 3600) * 1000));
        subtotal = timeResult.amountAfterRoundingVnd;
      } else {
        quantityMilli = Math.max(
          1,
          Math.round(
            (((effectiveEndedAt ?? now) - (effectiveStartedAt ?? now)) / 3_600_000) * 1000,
          ),
        );
        subtotal = checkedMoneyFromMilli(unitPriceVnd, quantityMilli);
      }
    } else {
      subtotal = checkedMoneyFromMilli(unitPriceVnd, quantityMilli);
    }
    let discountAmount = 0;
    if (input.discount) {
      if (input.discount.type === 'PERCENT') {
        if (input.discount.value > 100) {
          throw new AppError('DISCOUNT_INVALID', 'Phần trăm giảm giá không hợp lệ.', 422);
        }
        discountAmount = checkedPercentAmount(subtotal, input.discount.value);
      } else {
        discountAmount = input.discount.value;
      }
    }
    discountAmount = Math.min(subtotal, discountAmount);
    const normalizedNote = input.note?.trim() || null;
    const mergeableItem =
      product.product_type !== 'TIME' && !input.discount
        ? await this.repository.findMergeableOrderItem({
            storeId: input.storeId,
            orderId: input.orderId,
            takeaway: Boolean(takeawayOrder),
            productId: product.product_id,
            variantId: product.variant_id,
            unitPriceVnd,
            note: normalizedNote,
          })
        : null;
    const itemId = mergeableItem?.itemId ?? crypto.randomUUID();
    const command = {
      commandId: input.idempotencyKey,
      storeId: input.storeId,
      orderId: input.orderId,
      expectedOrderVersion: input.expectedOrderVersion,
      itemId,
      productId: product.product_id,
      variantId: product.product_type === 'TIME' ? null : product.variant_id,
      productType: product.product_type,
      productName: product.product_name,
      variantName: product.variant_name,
      unitName: product.unit_name,
      unitPriceVnd,
      quantityMilli,
      ...(product.product_type === 'TIME'
        ? {
            timeStartedAtMs: effectiveStartedAt,
            timeEndedAtMs: effectiveEndedAt,
          }
        : {}),
      note: normalizedNote,
      discountType: input.discount?.type ?? null,
      discountInputValue: input.discount?.value ?? null,
      discountAmountVnd: discountAmount,
      grossLineTotalVnd: subtotal,
      netLineTotalVnd: subtotal - discountAmount,
      actorId: input.actorId,
      requestId: input.requestId,
      issuedAt: now,
    };
    try {
      if (takeawayOrder) await this.repository.executeAddTakeawayItem(command);
      else await this.repository.executeAddItem(command);
      await this.repository.setOrderItemDiscountReason({
        storeId: input.storeId,
        orderType: takeawayOrder ? 'TAKEAWAY' : 'DINE_IN',
        orderId: input.orderId,
        itemId,
        reason: input.discount?.reason.trim() || null,
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: {
        actorUserId: input.actorId,
        actorSessionId: input.actorSessionId ?? null,
        deviceId: input.deviceId ?? null,
        requestId: input.requestId,
      },
      action: input.discount ? 'ORDER_ITEM_ADDED_WITH_DISCOUNT' : 'ORDER_ITEM_ADDED',
      entityType: 'ORDER_ITEM',
      entityId: itemId,
      before: null,
      after: {
        orderId: input.orderId,
        productId: product.product_id,
        variantId: product.product_type === 'TIME' ? null : product.variant_id,
        unitPriceVnd,
        quantityMilli,
        timeStartedAtMs: product.product_type === 'TIME' ? effectiveStartedAt : null,
        timeEndedAtMs: product.product_type === 'TIME' ? effectiveEndedAt : null,
        discountType: input.discount?.type ?? null,
        discountInputValue: input.discount?.value ?? null,
        discountAmountVnd: discountAmount,
        discountReason: input.discount?.reason.trim() || null,
        grossLineTotalVnd: subtotal,
        netLineTotalVnd: subtotal - discountAmount,
        note: normalizedNote,
      },
      now,
    });
    return { itemId, orderId: input.orderId };
  }

  async updateItem(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    itemId: string;
    expectedOrderVersion: number;
    quantityMilli: number;
    variantId?: string | null | undefined;
    discount?: null | { type: 'FIXED' | 'PERCENT'; value: number; reason: string } | undefined;
    timeStartedAtMs?: number | null | undefined;
    timeEndedAtMs?: number | null | undefined;
    note: string | null;
    now?: number;
  }) {
    const replay = await this.repository.findUpdateItemCommand(input.storeId, input.idempotencyKey);
    if (replay) return replay;
    const now = input.now ?? Date.now();
    const order =
      (await this.repository.findOrder(input.storeId, input.orderId)) ??
      (await this.repository.findTakeawayOrder(input.storeId, input.orderId));
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);
    const item = await this.repository.findOrderItemType(
      input.storeId,
      order.order_type,
      input.orderId,
      input.itemId,
    );
    if (!item) throw new AppError('ORDER_ITEM_NOT_FOUND', 'Không tìm thấy mặt hàng.', 404);
    if (item.productType === 'QUANTITY' && input.quantityMilli % 1000 !== 0) {
      throw new AppError(
        'QUANTITY_MUST_BE_WHOLE',
        'Mặt hàng theo số lượng phải là số nguyên.',
        422,
      );
    }
    const effectiveStartedAt =
      item.productType === 'TIME'
        ? (input.timeStartedAtMs ?? item.timeStartedAtMs ?? now)
        : input.timeStartedAtMs;
    const effectiveEndedAt =
      item.productType === 'TIME'
        ? input.timeEndedAtMs === undefined
          ? item.timeEndedAtMs
          : input.timeEndedAtMs
        : null;

    if (item.productType === 'TIME') {
      if (
        effectiveStartedAt === null ||
        effectiveStartedAt === undefined ||
        !Number.isInteger(effectiveStartedAt) ||
        (effectiveEndedAt !== null &&
          effectiveEndedAt !== undefined &&
          (!Number.isInteger(effectiveEndedAt) || effectiveEndedAt <= effectiveStartedAt))
      ) {
        throw new AppError(
          'TIME_RANGE_INVALID',
          'Giờ vào và giờ ra của mặt hàng tính giờ không hợp lệ.',
          422,
        );
      }
    }
    let quantityMilli = input.quantityMilli;
    let unitPriceVnd = item.unitPriceSnapshot;
    let variantName = item.variantNameSnapshot;
    let variantId = item.variantId;

    if (
      item.productType !== 'TIME' &&
      input.variantId !== undefined &&
      input.variantId !== item.variantId
    ) {
      const product = await this.repository.findSaleVariant(
        input.storeId,
        item.productId,
        input.variantId,
      );
      if (!product || product.product_status !== 'ACTIVE' || product.variant_status !== 'ACTIVE') {
        throw new AppError('PRODUCT_NOT_AVAILABLE', 'Phiên bản giá không khả dụng.', 422);
      }
      unitPriceVnd = product.sale_price ?? item.unitPriceSnapshot;
      variantName = product.variant_name;
      variantId = product.variant_id;
    }

    let grossLineTotalVnd = checkedMoneyFromMilli(unitPriceVnd, quantityMilli);

    if (item.productType === 'TIME') {
      const pricingConfig = item.productId
        ? await this.productPricingSnapshot(input.storeId, item.productId)
        : null;
      if (pricingConfig) {
        unitPriceVnd = pricingConfig.basePriceVnd;
        const timeResult = calculateTimePrice({
          startedAtMs: effectiveStartedAt ?? now,
          endedAtMs: Math.max((effectiveStartedAt ?? now) + 1000, effectiveEndedAt ?? now),
          config: pricingConfig,
        });
        quantityMilli = Math.max(1, Math.round((timeResult.elapsedSeconds / 3600) * 1000));
        grossLineTotalVnd = timeResult.amountAfterRoundingVnd;
      } else {
        quantityMilli = Math.max(
          1,
          Math.round(
            (((effectiveEndedAt ?? now) - (effectiveStartedAt ?? now)) / 3_600_000) * 1000,
          ),
        );
        grossLineTotalVnd = checkedMoneyFromMilli(unitPriceVnd, quantityMilli);
      }
    }

    let discountType: string | null = item.discountType;
    let discountInputValue: number | null = item.discountInputValue;
    let discountAmountVnd = item.discountAmount;
    let discountReason: string | null = item.discountReason;

    if (input.discount !== undefined) {
      if (input.discount) {
        if (input.discount.type === 'PERCENT') {
          if (input.discount.value > 100) {
            throw new AppError('DISCOUNT_INVALID', 'Phần trăm giảm giá không hợp lệ.', 422);
          }
          discountAmountVnd = checkedPercentAmount(grossLineTotalVnd, input.discount.value);
        } else {
          discountAmountVnd = input.discount.value;
        }
        discountType = input.discount.type;
        discountInputValue = input.discount.value;
        discountReason = input.discount.reason.trim();
      } else {
        discountAmountVnd = 0;
        discountType = 'NONE';
        discountInputValue = -1;
        discountReason = null;
      }
    } else if (item.discountType) {
      if (item.discountType === 'PERCENT') {
        discountAmountVnd = checkedPercentAmount(grossLineTotalVnd, item.discountInputValue ?? 0);
      } else {
        discountAmountVnd = item.discountInputValue ?? 0;
      }
    }

    discountAmountVnd = Math.min(grossLineTotalVnd, discountAmountVnd);
    const netLineTotalVnd = grossLineTotalVnd - discountAmountVnd;

    try {
      await this.repository.updateOrderItem({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderType: order.order_type,
        orderId: input.orderId,
        itemId: input.itemId,
        expectedOrderVersion: input.expectedOrderVersion,
        quantityMilli,
        variantId,
        variantName,
        unitPriceVnd,
        discountType,
        discountInputValue,
        discountAmountVnd,
        grossLineTotalVnd,
        netLineTotalVnd,
        timeStartedAtMs: effectiveStartedAt ?? null,
        timeEndedAtMs: effectiveEndedAt ?? null,
        note: input.note?.trim() || null,
        actorId: input.actorId,
        requestId: input.requestId,
        issuedAt: now,
      });
      await this.repository.setOrderItemDiscountReason({
        storeId: input.storeId,
        orderType: order.order_type,
        orderId: input.orderId,
        itemId: input.itemId,
        reason: discountReason,
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    return { orderId: input.orderId, itemId: input.itemId };
  }

  async removeItem(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    itemId: string;
    expectedOrderVersion: number;
    reason?: string | undefined;
  }) {
    const replay = await this.repository.findRemoveItemCommand(input.storeId, input.idempotencyKey);
    if (replay) return replay;
    const order =
      (await this.repository.findOrder(input.storeId, input.orderId)) ??
      (await this.repository.findTakeawayOrder(input.storeId, input.orderId));
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);
    try {
      await this.repository.removeOrderItem({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderType: order.order_type,
        orderId: input.orderId,
        itemId: input.itemId,
        expectedOrderVersion: input.expectedOrderVersion,
        actorId: input.actorId,
        requestId: input.requestId,
        issuedAt: Date.now(),
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    if (input.reason) {
      await new AuditRepository(this.env.DB).enrichByRequest(input.storeId, input.requestId, {
        actorUserId: input.actorId,
        actorSessionId: null,
        deviceId: null,
        requestId: input.requestId,
      });
    }
    return { orderId: input.orderId, itemId: input.itemId, removed: true };
  }

  async removeTimeSession(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    expectedOrderVersion: number;
    reason: string;
    actorSessionId?: string | null;
    deviceId?: string | null;
  }) {
    const replay = await this.repository.findRemoveTimeSessionCommand(
      input.storeId,
      input.idempotencyKey,
    );
    if (replay) return { orderId: replay.orderId, removed: true };
    const order = await this.repository.findOrder(input.storeId, input.orderId);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);
    if (order.status !== 'OPEN') {
      throw new AppError('ORDER_NOT_OPEN', 'Đơn hàng không ở trạng thái mở.', 409);
    }
    if (order.version !== input.expectedOrderVersion) {
      throw new AppError('ORDER_VERSION_CONFLICT', 'Đơn hàng đã thay đổi. Vui lòng tải lại.', 409);
    }
    const session = await this.repository.findTimeSession(input.storeId, input.orderId);
    if (!session) {
      return { orderId: input.orderId, removed: true };
    }
    try {
      await this.repository.removeTimeSession({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderId: input.orderId,
        sessionId: session.id,
        expectedOrderVersion: input.expectedOrderVersion,
        reason: input.reason,
        actorId: input.actorId,
        actorSessionId: input.actorSessionId ?? null,
        deviceId: input.deviceId ?? null,
        requestId: input.requestId,
        issuedAt: Date.now(),
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    return { orderId: input.orderId, removed: true };
  }

  async updateNote(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    expectedOrderVersion: number;
    note: string | null;
  }) {
    const replay = await this.repository.findUpdateOrderNoteCommand(
      input.storeId,
      input.idempotencyKey,
    );
    if (replay) return replay;
    const order =
      (await this.repository.findOrder(input.storeId, input.orderId)) ??
      (await this.repository.findTakeawayOrder(input.storeId, input.orderId));
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);
    try {
      await this.repository.updateOrderNote({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderType: order.order_type,
        orderId: input.orderId,
        expectedOrderVersion: input.expectedOrderVersion,
        note: input.note?.trim() || null,
        actorId: input.actorId,
        requestId: input.requestId,
        issuedAt: Date.now(),
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    return { orderId: input.orderId };
  }

  async updateGuest(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    expectedOrderVersion: number;
    guestCount: number;
    customerName?: string | null;
    customerPhone?: string | null;
    customerId?: string | null;
  }) {
    const replay = await this.repository.findUpdateOrderGuestCommand(
      input.storeId,
      input.idempotencyKey,
    );
    if (replay) return replay;
    const order =
      (await this.repository.findOrder(input.storeId, input.orderId)) ??
      (await this.repository.findTakeawayOrder(input.storeId, input.orderId));
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);
    let customerName = input.customerName?.trim() || null;
    let customerPhone = input.customerPhone?.trim() || null;
    if (input.customerId) {
      const customer = await new CustomerService(this.env).detail(input.storeId, input.customerId);
      if (customer.status !== 'ACTIVE')
        throw new AppError('CUSTOMER_ARCHIVED', 'Khách hàng đã được lưu trữ.', 409);
      customerName = customer.name;
      customerPhone = customer.phone;
    }
    try {
      await this.repository.updateOrderGuest({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderType: order.order_type,
        orderId: input.orderId,
        expectedOrderVersion: input.expectedOrderVersion,
        guestCount: Math.max(1, input.guestCount),
        customerName,
        customerPhone,
        customerId: input.customerId ?? null,
        actorId: input.actorId,
        requestId: input.requestId,
        issuedAt: Date.now(),
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    return { orderId: input.orderId };
  }

  async quote(storeId: string, orderId: string, now = Date.now()) {
    const order =
      (await this.repository.findOrder(storeId, orderId)) ??
      (await this.repository.findTakeawayOrder(storeId, orderId));
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);

    const session = await this.repository.findTimeSession(storeId, orderId);
    const tableSegments = session
      ? (await this.repository.listTableTimeSegments(storeId, session.id)).results
      : [];
    const pauses = session ? await this.repository.listPauses(storeId, session.id) : null;
    const currentPause = pauses?.results.find((p) => p.resumedAtMs === null);
    const pausedAtMs = currentPause ? currentPause.pausedAtMs : null;
    const sessionPauses = pauses
      ? pauses.results.map((pause) => ({
          pausedAtMs: pause.pausedAtMs,
          resumedAtMs: pause.resumedAtMs ?? now,
        }))
      : [];

    let pricing:
      | (PricingResult & {
          status: 'RUNNING' | 'PAUSED' | 'ENDED';
          startedAtMs: number;
          endedAtMs: number | null;
          pausedAtMs: number | null;
          pricingConfig: PricingConfigSnapshot;
          tableSegments?: Array<{
            tableId: string;
            tableName: string;
            startedAtMs: number;
            endedAtMs: number | null;
            elapsedSeconds: number;
            amountBeforeRoundingVnd: number;
            amountAfterRoundingVnd: number;
            pricingConfig: PricingConfigSnapshot;
          }>;
        })
      | null = null;

    if (session) {
      if (tableSegments.length > 0) {
        let totalElapsedSeconds = 0;
        let totalAmountBeforeRounding = 0;
        let totalAmountAfterRounding = 0;
        const allSegments: PricingSegment[] = [];
        const processedTableSegments: Array<{
          tableId: string;
          tableName: string;
          startedAtMs: number;
          endedAtMs: number | null;
          elapsedSeconds: number;
          amountBeforeRoundingVnd: number;
          amountAfterRoundingVnd: number;
          pricingConfig: PricingConfigSnapshot;
        }> = [];

        for (let i = 0; i < tableSegments.length; i++) {
          const seg = tableSegments[i]!;
          const isFirst = i === 0;
          const isLast = i === tableSegments.length - 1;
          const segStarted = isFirst ? session.started_at : seg.started_at;
          const rawEnd = isLast
            ? (session.ended_at ?? now)
            : (seg.ended_at ?? session.ended_at ?? now);
          const segEnded = Math.max(segStarted + 1, rawEnd);
          const segConfig = JSON.parse(seg.pricing_snapshot_json) as PricingConfigSnapshot;
          const segPauses = sessionPauses.filter(
            (p) => p.resumedAtMs > segStarted && p.pausedAtMs < segEnded,
          );

          const segPricing = calculateTimePrice({
            startedAtMs: segStarted,
            endedAtMs: segEnded,
            pauses: segPauses,
            config: segConfig,
          });

          totalElapsedSeconds += segPricing.elapsedSeconds;
          totalAmountBeforeRounding += segPricing.amountBeforeRoundingVnd;
          totalAmountAfterRounding += segPricing.amountAfterRoundingVnd;
          allSegments.push(...segPricing.segments);

          processedTableSegments.push({
            tableId: seg.table_id,
            tableName: seg.table_name_snapshot,
            startedAtMs: segStarted,
            endedAtMs: isLast ? session.ended_at : seg.ended_at,
            elapsedSeconds: segPricing.elapsedSeconds,
            amountBeforeRoundingVnd: segPricing.amountBeforeRoundingVnd,
            amountAfterRoundingVnd: segPricing.amountAfterRoundingVnd,
            pricingConfig: segConfig,
          });
        }

        const latestConfig = JSON.parse(
          tableSegments[tableSegments.length - 1]!.pricing_snapshot_json,
        ) as PricingConfigSnapshot;

        pricing = {
          elapsedSeconds: totalElapsedSeconds,
          amountBeforeRoundingVnd: totalAmountBeforeRounding,
          amountAfterRoundingVnd: totalAmountAfterRounding,
          segments: allSegments,
          status: session.status,
          startedAtMs: session.started_at,
          endedAtMs: session.ended_at,
          pausedAtMs,
          pricingConfig: latestConfig,
          tableSegments: processedTableSegments,
        };
      } else {
        const pricingConfig = JSON.parse(session.pricing_snapshot_json) as PricingConfigSnapshot;
        const singlePricing = calculateTimePrice({
          startedAtMs: session.started_at,
          endedAtMs: Math.max(session.started_at + 1, session.ended_at ?? now),
          pauses: sessionPauses,
          config: pricingConfig,
        });
        pricing = {
          ...singlePricing,
          status: session.status,
          startedAtMs: session.started_at,
          endedAtMs: session.ended_at,
          pausedAtMs,
          pricingConfig,
        };
      }
    }

    const items =
      order.order_type === 'TAKEAWAY'
        ? await this.repository.listTakeawayOrderItems(storeId, orderId)
        : await this.repository.listOrderItems(storeId, orderId);

    const processedItems = await Promise.all(
      items.results.map(async (item) => {
        if (item.productType === 'TIME' && item.timeStartedAtMs) {
          const productPricing = await this.productPricingSnapshot(storeId, item.productId);
          if (productPricing) {
            const startedAt = item.timeStartedAtMs;
            const endedAt = item.timeEndedAtMs ?? now;
            const timeCalc = calculateTimePrice({
              startedAtMs: startedAt,
              endedAtMs: Math.max(startedAt + 1000, endedAt),
              config: productPricing,
            });
            const durationMilli = Math.max(1, Math.round((timeCalc.elapsedSeconds / 3600) * 1000));
            const gross = timeCalc.amountAfterRoundingVnd;
            const discountAmount =
              item.discountType === 'PERCENT'
                ? Math.min(gross, Math.round((gross * (item.discountInputValue ?? 0)) / 100))
                : item.discountType === 'FIXED'
                  ? Math.min(gross, item.discountInputValue ?? 0)
                  : 0;
            const net = gross - discountAmount;
            return Object.assign({}, item, {
              quantityMilli: durationMilli,
              grossLineTotalVnd: gross,
              discountAmountVnd: discountAmount,
              netLineTotalVnd: net,
              timePricing: {
                ...timeCalc,
                pricingConfig: productPricing,
              },
            });
          }
        }
        return item;
      }),
    );
    const productGross = processedItems.reduce(
      (sum, item) => sum + Number(item.grossLineTotalVnd),
      0,
    );
    const discountTotal = processedItems.reduce(
      (sum, item) => sum + Number(item.discountAmountVnd),
      0,
    );
    const bankSettings = await this.repository.findStoreBankSettings(storeId);
    const subtotal = productGross + (pricing?.amountAfterRoundingVnd ?? 0);
    const promotions = await new PromotionService(this.env).optionsForOrder({
      storeId,
      orderId,
      subtotalVnd: Math.max(0, subtotal - discountTotal),
      customerId: order.customer_id ?? null,
      items: processedItems.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        productType: item.productType,
        productName: item.productName,
        variantName: item.variantName,
        unitPriceVnd: Number(item.unitPriceVnd),
        quantityMilli: Number(item.quantityMilli),
        grossLineTotalVnd: Number(item.grossLineTotalVnd),
        netLineTotalVnd: Number(item.netLineTotalVnd),
      })),
      now,
    });
    const promotionDiscount = promotions.applied.reduce(
      (sum, promotion) => sum + promotion.discountAmountVnd,
      0,
    );
    const promotionGiftItems = promotions.applied.flatMap((promotion) =>
      promotion.giftItems.map((gift) => ({
        id: `promotion-gift:${promotion.id}:${gift.productId}:${gift.variantId}`,
        productId: gift.productId,
        variantId: gift.variantId,
        productType: 'QUANTITY' as const,
        productName: gift.productName,
        variantName: gift.variantName,
        unitName: gift.unitName,
        unitPriceVnd: gift.unitPriceVnd,
        quantityMilli: gift.quantityMilli,
        discountType: 'PERCENT' as const,
        discountInputValue: 100,
        discountAmountVnd: gift.grossAmountVnd,
        discountReason: `Quà tặng · ${promotion.name}`,
        grossLineTotalVnd: gift.grossAmountVnd,
        netLineTotalVnd: 0,
        lineTotalVnd: 0,
        note: null,
        timeStartedAtMs: null,
        timeEndedAtMs: null,
        promotionGift: {
          promotionId: promotion.id,
          promotionName: promotion.name,
        },
      })),
    );
    return {
      order: {
        id: order.id,
        displayCode: order.display_code,
        orderType: order.order_type,
        tableId: order.table_id,
        tableName: order.table_name,
        areaId: order.area_id,
        areaName: order.area_name,
        status: order.status,
        version: order.version,
        openedAt: order.opened_at,
        openedByName: order.opened_by_name ?? null,
        note: order.note,
        guestCount: order.guest_count ?? 1,
        customerName: order.customer_name ?? null,
        customerPhone: order.customer_phone ?? null,
        customerId: order.customer_id ?? null,
      },
      items: [...processedItems, ...promotionGiftItems],
      time: pricing,
      subtotalVnd: subtotal,
      discountTotalVnd: discountTotal + promotionDiscount,
      itemDiscountTotalVnd: discountTotal,
      promotionDiscountVnd: promotionDiscount,
      promotions: promotions.applied,
      promotion: promotions.applied[0] ?? null,
      promotionOptions: promotions.options,
      totalVnd: Math.max(0, subtotal - discountTotal - promotionDiscount),
      bankSettings: bankSettings ?? null,
    };
  }

  async applyPromotion(input: {
    storeId: string;
    orderId: string;
    promotionIds: string[];
    expectedOrderVersion: number;
    actorId: string;
  }) {
    const quote = await this.quote(input.storeId, input.orderId);
    return new PromotionService(this.env).applyToOrder({
      ...input,
      orderType: quote.order.orderType,
      subtotalVnd: Math.max(0, quote.subtotalVnd - quote.itemDiscountTotalVnd),
      customerId: quote.order.customerId,
      items: quote.items
        .filter((item) => !('promotionGift' in item))
        .map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          productType: item.productType,
          productName: item.productName,
          variantName: item.variantName,
          unitPriceVnd: Number(item.unitPriceVnd),
          quantityMilli: Number(item.quantityMilli),
          grossLineTotalVnd: Number(item.grossLineTotalVnd),
          netLineTotalVnd: Number(item.netLineTotalVnd),
        })),
    });
  }

  async pause(input: {
    storeId: string;
    orderId: string;
    actorId: string;
    expectedOrderVersion: number;
    actorSessionId?: string | null;
    deviceId?: string | null;
    requestId: string;
    idempotencyKey: string;
  }) {
    const replay = await this.repository.findPauseCommand(input.storeId, input.idempotencyKey);
    if (replay) return { ...replay, paused: true };
    try {
      await this.repository.pauseTime({
        commandId: input.idempotencyKey,
        pauseId: crypto.randomUUID(),
        ...input,
        now: Date.now(),
        actorSessionId: input.actorSessionId ?? null,
        deviceId: input.deviceId ?? null,
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    return { orderId: input.orderId, paused: true };
  }

  async resume(input: {
    storeId: string;
    orderId: string;
    actorId: string;
    expectedOrderVersion: number;
    actorSessionId?: string | null;
    deviceId?: string | null;
    requestId: string;
    idempotencyKey: string;
  }) {
    const replay = await this.repository.findResumeCommand(input.storeId, input.idempotencyKey);
    if (replay) return { ...replay, resumed: true };
    try {
      await this.repository.resumeTime({
        commandId: input.idempotencyKey,
        ...input,
        now: Date.now(),
        actorSessionId: input.actorSessionId ?? null,
        deviceId: input.deviceId ?? null,
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    return { orderId: input.orderId, resumed: true };
  }

  async updateTimeRange(input: {
    storeId: string;
    orderId: string;
    actorId: string;
    expectedOrderVersion: number;
    startedAtMs: number;
    endedAtMs: number | null;
    actorSessionId?: string | null;
    deviceId?: string | null;
    requestId: string;
    idempotencyKey: string;
    now?: number;
  }) {
    const replay =
      (await this.repository.findUpdateTimeRangeCommand(input.storeId, input.idempotencyKey)) ??
      (await this.repository.findCreateTimeSessionCommand(input.storeId, input.idempotencyKey));
    if (replay) return replay;
    const now = input.now ?? Date.now();
    const order = await this.repository.findOrder(input.storeId, input.orderId);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn tại chỗ.', 404);
    const session = await this.repository.findTimeSession(input.storeId, input.orderId);
    if (
      input.startedAtMs > now ||
      (input.endedAtMs !== null && (input.endedAtMs <= input.startedAtMs || input.endedAtMs > now))
    ) {
      throw new AppError(
        'TIME_RANGE_INVALID',
        'Giờ vào/giờ ra không hợp lệ hoặc vượt quá thời điểm hiện tại.',
        422,
      );
    }
    if (!session) {
      if (order.order_type !== 'DINE_IN' || !order.table_id) {
        throw new AppError(
          'ORDER_TIME_SESSION_MISSING',
          'Đơn thiếu phiên tính giờ hoặc không phải đơn tại chỗ.',
          409,
        );
      }
      const pricing = await this.pricingSnapshot(input.storeId, order.table_id);
      const timeSessionId = crypto.randomUUID();
      try {
        await this.repository.createTimeSessionForOrder({
          commandId: input.idempotencyKey,
          storeId: input.storeId,
          orderId: input.orderId,
          timeSessionId,
          tableId: order.table_id,
          timeProductId: pricing.row.product_id,
          tableName: order.table_name ?? 'Bàn',
          pricingSnapshotJson: JSON.stringify(pricing.config),
          pricingVersion: pricing.config.version,
          startedAtMs: input.startedAtMs,
          endedAtMs: input.endedAtMs,
          status: input.endedAtMs ? 'ENDED' : 'RUNNING',
          expectedOrderVersion: input.expectedOrderVersion,
          actorId: input.actorId,
          actorSessionId: input.actorSessionId ?? null,
          deviceId: input.deviceId ?? null,
          requestId: input.requestId,
          now,
        });
      } catch (error) {
        mapDatabaseError(error);
      }
      return {
        orderId: input.orderId,
        startedAtMs: input.startedAtMs,
        endedAtMs: input.endedAtMs,
      };
    }
    try {
      await this.repository.updateTimeRange({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderId: input.orderId,
        expectedOrderVersion: input.expectedOrderVersion,
        previousStartedAtMs: session.started_at,
        previousEndedAtMs: session.ended_at,
        previousStatus: session.status,
        startedAtMs: input.startedAtMs,
        endedAtMs: input.endedAtMs,
        actorId: input.actorId,
        actorSessionId: input.actorSessionId ?? null,
        deviceId: input.deviceId ?? null,
        requestId: input.requestId,
        now,
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    return {
      orderId: input.orderId,
      startedAtMs: input.startedAtMs,
      endedAtMs: input.endedAtMs,
    };
  }

  async stopTimeForCheckout(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    expectedOrderVersion: number;
    actorSessionId?: string | null;
    deviceId?: string | null;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const replay = await this.repository.findStopTimeCommand(input.storeId, input.idempotencyKey);
    if (replay) {
      const quote = await this.quote(input.storeId, input.orderId, now);
      return {
        orderId: input.orderId,
        status: 'PAYMENT_PENDING' as const,
        stoppedAt: replay.stoppedAt,
        quote,
      };
    }

    const order = await this.repository.findOrder(input.storeId, input.orderId);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);

    if (order.status === 'PAYMENT_PENDING') {
      const quote = await this.quote(input.storeId, input.orderId, now);
      return {
        orderId: input.orderId,
        status: 'PAYMENT_PENDING' as const,
        stoppedAt: quote.time?.endedAtMs ?? now,
        quote,
      };
    }

    if (order.status !== 'OPEN') {
      throw new AppError('ORDER_NOT_OPEN', 'Đơn hàng không ở trạng thái mở.', 409);
    }
    if (order.version !== input.expectedOrderVersion) {
      throw new AppError('ORDER_VERSION_CONFLICT', 'Đơn hàng đã thay đổi. Vui lòng tải lại.', 409);
    }

    try {
      await this.repository.stopTimeForCheckout({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderId: input.orderId,
        expectedOrderVersion: input.expectedOrderVersion,
        actorId: input.actorId,
        actorSessionId: input.actorSessionId ?? null,
        deviceId: input.deviceId ?? null,
        requestId: input.requestId,
        issuedAt: now,
      });
    } catch (error) {
      mapDatabaseError(error);
    }

    const quote = await this.quote(input.storeId, input.orderId, now);
    const consistentQuote = {
      ...quote,
      order: {
        ...quote.order,
        status: 'PAYMENT_PENDING' as const,
      },
      time: quote.time
        ? {
            ...quote.time,
            status: 'ENDED' as const,
            endedAtMs: quote.time.endedAtMs ?? now,
          }
        : null,
    };
    return {
      orderId: input.orderId,
      status: 'PAYMENT_PENDING' as const,
      stoppedAt: now,
      quote: consistentQuote,
    };
  }

  async resumeCheckout(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    expectedOrderVersion: number;
    actorSessionId?: string | null;
    deviceId?: string | null;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const replay = await this.repository.findResumeCheckoutCommand(
      input.storeId,
      input.idempotencyKey,
    );
    if (replay) {
      const quote = await this.quote(input.storeId, input.orderId, now);
      return {
        orderId: input.orderId,
        status: 'OPEN' as const,
        resumedAt: replay.resumedAt,
        quote,
      };
    }

    const order = await this.repository.findOrder(input.storeId, input.orderId);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);

    if (order.status === 'OPEN') {
      const quote = await this.quote(input.storeId, input.orderId, now);
      return {
        orderId: input.orderId,
        status: 'OPEN' as const,
        resumedAt: quote.time?.startedAtMs ?? now,
        quote,
      };
    }

    if (order.status !== 'PAYMENT_PENDING') {
      throw new AppError(
        'ORDER_NOT_PAYMENT_PENDING',
        'Đơn hàng không ở trạng thái chờ thanh toán.',
        409,
      );
    }
    if (order.version !== input.expectedOrderVersion) {
      throw new AppError('ORDER_VERSION_CONFLICT', 'Đơn hàng đã thay đổi. Vui lòng tải lại.', 409);
    }

    try {
      await this.repository.resumeCheckout({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderId: input.orderId,
        expectedOrderVersion: input.expectedOrderVersion,
        actorId: input.actorId,
        actorSessionId: input.actorSessionId ?? null,
        deviceId: input.deviceId ?? null,
        requestId: input.requestId,
        issuedAt: now,
      });
    } catch (error) {
      mapDatabaseError(error);
    }

    const quote = await this.quote(input.storeId, input.orderId, now);
    return {
      orderId: input.orderId,
      status: 'OPEN' as const,
      resumedAt: now,
      quote,
    };
  }

  async checkout(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    expectedOrderVersion: number;
    method: 'CASH' | 'BANK_TRANSFER';
    cashReceivedVnd: number | null;
    allocations?: Array<{
      method: 'CASH' | 'BANK_TRANSFER';
      amountVnd: number;
      tenderedVnd?: number | undefined;
    }>;
    debtAmountVnd?: number;
    actorSessionId?: string | null;
    deviceId?: string | null;
    now?: number;
  }) {
    const replay =
      (await this.repository.findCheckoutCommand(input.storeId, input.idempotencyKey)) ??
      (await this.repository.findTakeawayCheckoutCommand(input.storeId, input.idempotencyKey));
    if (replay) return replay;
    const now = input.now ?? Date.now();
    const quote = await this.quote(input.storeId, input.orderId, now);
    if (quote.order.status !== 'OPEN' && quote.order.status !== 'PAYMENT_PENDING') {
      throw new AppError('ORDER_NOT_ACTIVE', 'Đơn hàng không ở trạng thái có thể thanh toán.', 409);
    }
    if (quote.order.orderType === 'DINE_IN' && !quote.order.tableId) {
      throw new AppError('DINE_IN_ORDER_REQUIRED', 'Đơn tại chỗ thiếu thông tin bàn.', 409);
    }
    if (quote.order.version !== input.expectedOrderVersion) {
      throw new AppError('ORDER_VERSION_CONFLICT', 'Đơn hàng đã thay đổi. Vui lòng tải lại.', 409);
    }
    const allocationsInput = input.allocations ?? [];
    const debtAmountVnd = input.debtAmountVnd ?? 0;
    const usingAllocations = allocationsInput.length > 0 || debtAmountVnd > 0;
    const paidVnd = allocationsInput.reduce((sum, allocation) => sum + allocation.amountVnd, 0);
    if (usingAllocations && paidVnd + debtAmountVnd !== quote.totalVnd) {
      throw new AppError(
        'PAYMENT_ALLOCATION_INVALID',
        'Tổng thanh toán và công nợ không khớp giá trị hóa đơn.',
        422,
      );
    }
    if (debtAmountVnd > 0 && !quote.order.customerId) {
      throw new AppError(
        'CUSTOMER_REQUIRED_FOR_DEBT',
        'Vui lòng chọn khách hàng trước khi ghi nợ.',
        422,
      );
    }
    for (const allocation of allocationsInput) {
      if (
        allocation.method === 'CASH' &&
        (allocation.tenderedVnd ?? allocation.amountVnd) < allocation.amountVnd
      ) {
        throw new AppError('INSUFFICIENT_CASH', 'Tiền khách đưa không đủ.', 422);
      }
    }
    const firstAllocationMethod = allocationsInput[0]?.method;
    const legacyMethod = usingAllocations
      ? firstAllocationMethod === 'CASH'
        ? 'CASH'
        : 'BANK_TRANSFER'
      : input.method;
    const cashReceived = usingAllocations
      ? legacyMethod === 'CASH'
        ? quote.totalVnd
        : null
      : input.method === 'CASH'
        ? input.cashReceivedVnd
        : null;
    if (
      !usingAllocations &&
      input.method === 'CASH' &&
      (cashReceived === null || cashReceived < quote.totalVnd)
    ) {
      throw new AppError('INSUFFICIENT_CASH', 'Tiền khách đưa không đủ.', 422);
    }
    const invoiceId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const businessDay = await this.businessDay(input.storeId, now);
    const finalizedTime = quote.time
      ? {
          ...quote.time,
          status: 'ENDED' as const,
          endedAtMs: quote.time.endedAtMs ?? now,
        }
      : null;
    const invoiceSnapshot = {
      order: quote.order,
      items: quote.items,
      time: finalizedTime,
      totals: {
        subtotalVnd: quote.subtotalVnd,
        discountTotalVnd: quote.discountTotalVnd,
        totalVnd: quote.totalVnd,
      },
      issuedAt: now,
      promotion: quote.promotion,
      promotions: quote.promotions,
    };
    const timeDescription =
      quote.time?.tableSegments && quote.time.tableSegments.length > 1
        ? `Tiền giờ ${quote.time.tableSegments.map((s: { tableName: string }) => s.tableName).join(' → ')}`
        : quote.time
          ? `Tiền giờ ${quote.order.tableName}`
          : '';
    const promotionGiftItems = quote.items.flatMap((item) => {
      const giftMarker =
        'promotionGift' in item
          ? (item.promotionGift as
              { promotionId: string; promotionName: string } | null | undefined)
          : null;
      if (!giftMarker) return [];
      return [
        {
          id: `promotion-gift:${invoiceId}:${giftMarker.promotionId}:${item.variantId}`,
          description: `${item.productName} (Quà tặng)`,
          quantityMilli: item.quantityMilli,
          unitPriceVnd: item.unitPriceVnd,
          discountAmountVnd: item.discountAmountVnd,
          grossLineTotalVnd: item.grossLineTotalVnd,
          snapshotJson: JSON.stringify(item),
        },
      ];
    });
    try {
      if (quote.order.orderType === 'TAKEAWAY') {
        await this.repository.executeTakeawayCheckout({
          idempotencyKey: input.idempotencyKey,
          storeId: input.storeId,
          orderId: input.orderId,
          expectedOrderVersion: input.expectedOrderVersion,
          paymentId,
          invoiceId,
          businessDay,
          method: legacyMethod,
          subtotal: quote.subtotalVnd,
          discountTotal: quote.discountTotalVnd,
          total: quote.totalVnd,
          cashReceived,
          cashChange: cashReceived === null ? null : cashReceived - quote.totalVnd,
          invoiceSnapshotJson: JSON.stringify(invoiceSnapshot),
          promotionGiftItems,
          actorId: input.actorId,
          requestId: input.requestId,
          issuedAt: now,
        });
      } else {
        await this.repository.executeCheckout({
          idempotencyKey: input.idempotencyKey,
          storeId: input.storeId,
          orderId: input.orderId,
          tableId: quote.order.tableId!,
          expectedOrderVersion: input.expectedOrderVersion,
          paymentId,
          invoiceId,
          businessDay,
          method: legacyMethod,
          subtotal: quote.subtotalVnd,
          discountTotal: quote.discountTotalVnd,
          total: quote.totalVnd,
          cashReceived,
          cashChange: cashReceived === null ? null : cashReceived - quote.totalVnd,
          timeDescription,
          timeElapsedSeconds: quote.time?.elapsedSeconds ?? 0,
          timeAmount: quote.time?.amountAfterRoundingVnd ?? 0,
          timeSnapshotJson: finalizedTime ? JSON.stringify(finalizedTime) : '{}',
          invoiceSnapshotJson: JSON.stringify(invoiceSnapshot),
          promotionGiftItems,
          actorId: input.actorId,
          requestId: input.requestId,
          issuedAt: now,
        });
      }
    } catch (error) {
      mapDatabaseError(error);
    }
    await Promise.all(
      quote.promotions.map((promotion) =>
        new PromotionRepository(this.env.DB).saveInvoicePromotion({
          storeId: input.storeId,
          invoiceId,
          orderType: quote.order.orderType,
          promotionId: promotion.id,
          promotionName: promotion.name,
          promotionType: promotion.type,
          // Đồng giá is a price adjustment, not promotional discount value in reports.
          discountAmountVnd: promotion.type === 'FLAT_PRICE' ? 0 : promotion.discountAmountVnd,
          snapshotJson: JSON.stringify(promotion),
          now,
        }),
      ),
    );
    if (quote.order.customerId) {
      const settings = await new CustomerService(this.env).loyaltySettings(input.storeId);
      const points = settings.enabled ? Math.floor(quote.totalVnd / settings.vndPerPoint) : 0;
      const statements: D1PreparedStatement[] = [
        this.env.DB.prepare(
          `UPDATE customers SET invoice_count = invoice_count + 1,
          total_spent_vnd = total_spent_vnd + ?, loyalty_points = loyalty_points + ?,
          debt_balance_vnd = debt_balance_vnd + ?, last_order_at = ?, updated_at = ?
          WHERE store_id = ? AND id = ?`,
        ).bind(
          quote.totalVnd,
          points,
          debtAmountVnd,
          now,
          now,
          input.storeId,
          quote.order.customerId,
        ),
      ];
      const invoiceTable = quote.order.orderType === 'TAKEAWAY' ? 'takeaway_invoices' : 'invoices';
      statements.push(
        this.env.DB.prepare(
          `UPDATE ${invoiceTable} SET customer_id = ? WHERE store_id = ? AND id = ?`,
        ).bind(quote.order.customerId, input.storeId, invoiceId),
      );
      const allocations = usingAllocations
        ? allocationsInput
        : [
            {
              method: input.method,
              amountVnd: quote.totalVnd,
              ...(cashReceived === null ? {} : { tenderedVnd: cashReceived }),
            },
          ];
      for (const allocation of allocations)
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO invoice_payment_allocations
        (id, store_id, invoice_id, method, amount_vnd, tendered_vnd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            input.storeId,
            invoiceId,
            allocation.method,
            allocation.amountVnd,
            allocation.tenderedVnd ?? null,
            now,
          ),
        );
      if (debtAmountVnd > 0) {
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO invoice_payment_allocations
          (id, store_id, invoice_id, method, amount_vnd, created_at) VALUES (?, ?, ?, 'DEBT', ?, ?)`,
          ).bind(crypto.randomUUID(), input.storeId, invoiceId, debtAmountVnd, now),
        );
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO customer_debt_entries
          (id, store_id, customer_id, invoice_id, entry_type, amount_vnd, reference, actor_user_id, idempotency_key, created_at)
          VALUES (?, ?, ?, ?, 'CHARGE', ?, ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            input.storeId,
            quote.order.customerId,
            invoiceId,
            debtAmountVnd,
            quote.order.displayCode ?? null,
            input.actorId,
            `checkout-debt:${invoiceId}`,
            now,
          ),
        );
      }
      if (points > 0)
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO customer_loyalty_entries
        (id, store_id, customer_id, invoice_id, entry_type, points, balance_after, note, actor_user_id, created_at)
        SELECT ?, ?, ?, ?, 'EARN', ?, loyalty_points, 'Tích điểm từ hóa đơn', ?, ? FROM customers WHERE store_id = ? AND id = ?`,
          ).bind(
            crypto.randomUUID(),
            input.storeId,
            quote.order.customerId,
            invoiceId,
            points,
            input.actorId,
            now,
            input.storeId,
            quote.order.customerId,
          ),
        );
      await this.env.DB.batch(statements);
    }
    await new AuditRepository(this.env.DB).enrichByRequest(input.storeId, input.requestId, {
      actorUserId: input.actorId,
      actorSessionId: input.actorSessionId ?? null,
      deviceId: input.deviceId ?? null,
      requestId: input.requestId,
    });
    const completed =
      (await this.repository.findCheckoutCommand(input.storeId, input.idempotencyKey)) ??
      (await this.repository.findTakeawayCheckoutCommand(input.storeId, input.idempotencyKey));
    return {
      invoiceId,
      paymentId,
      orderId: input.orderId,
      displayCode: completed!.displayCode,
      total: quote.totalVnd,
      method: legacyMethod,
    };
  }

  async transfer(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    targetTableId: string;
    expectedOrderVersion: number;
    expectedSourceTableVersion: number;
    expectedTargetTableVersion: number;
    actorSessionId?: string | null;
    deviceId?: string | null;
    now?: number;
  }) {
    const replay = await this.repository.findTransferCommand(input.storeId, input.idempotencyKey);
    if (replay) return replay;
    const now = input.now ?? Date.now();
    const order = await this.repository.findOrder(input.storeId, input.orderId);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);
    if (order.order_type !== 'DINE_IN' || !order.table_id) {
      throw new AppError('DINE_IN_ORDER_REQUIRED', 'Chỉ đơn tại chỗ mới có thể chuyển bàn.', 422);
    }
    if (order.table_id === input.targetTableId) {
      throw new AppError('SAME_TABLE_TRANSFER', 'Bàn chuyển tới phải khác bàn hiện tại.', 422);
    }
    const [session, targetPricing] = await Promise.all([
      this.repository.findTimeSession(input.storeId, input.orderId),
      this.pricingSnapshot(input.storeId, input.targetTableId),
    ]);
    if (!session) {
      throw new AppError('ORDER_TIME_SESSION_MISSING', 'Đơn tại chỗ thiếu phiên tính giờ.', 409);
    }
    if (targetPricing.row.table_status !== 'AVAILABLE') {
      throw new AppError('TABLE_NOT_AVAILABLE', 'Bàn chuyển tới không còn trống.', 409);
    }

    try {
      await this.repository.executeTransfer({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderId: input.orderId,
        sourceTableId: order.table_id,
        targetTableId: input.targetTableId,
        expectedOrderVersion: input.expectedOrderVersion,
        expectedSourceVersion: input.expectedSourceTableVersion,
        expectedTargetVersion: input.expectedTargetTableVersion,
        targetPricingSnapshotJson: JSON.stringify(targetPricing.config),
        targetPricingVersion: targetPricing.config.version,
        actorId: input.actorId,
        requestId: input.requestId,
        now,
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    await new AuditRepository(this.env.DB).enrichByRequest(input.storeId, input.requestId, {
      actorUserId: input.actorId,
      actorSessionId: input.actorSessionId ?? null,
      deviceId: input.deviceId ?? null,
      requestId: input.requestId,
    });
    return { orderId: input.orderId, targetTableId: input.targetTableId };
  }

  async cancel(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    expectedOrderVersion: number;
    reason: string;
    actorSessionId?: string | null;
    deviceId?: string | null;
  }) {
    const replay =
      (await this.repository.findCancelCommand(input.storeId, input.idempotencyKey)) ??
      (await this.repository.findCancelTakeawayCommand(input.storeId, input.idempotencyKey));
    if (replay) return { ...replay, cancelled: true };
    const order =
      (await this.repository.findOrder(input.storeId, input.orderId)) ??
      (await this.repository.findTakeawayOrder(input.storeId, input.orderId));
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);
    try {
      if (order.order_type === 'TAKEAWAY') {
        await this.repository.executeCancelTakeaway({
          commandId: input.idempotencyKey,
          storeId: input.storeId,
          orderId: input.orderId,
          expectedOrderVersion: input.expectedOrderVersion,
          reason: input.reason.trim(),
          actorId: input.actorId,
          requestId: input.requestId,
          now: Date.now(),
        });
      } else {
        await this.repository.executeCancel({
          commandId: input.idempotencyKey,
          storeId: input.storeId,
          orderId: input.orderId,
          tableId: order.table_id!,
          expectedOrderVersion: input.expectedOrderVersion,
          reason: input.reason.trim(),
          actorId: input.actorId,
          requestId: input.requestId,
          now: Date.now(),
        });
      }
    } catch (error) {
      mapDatabaseError(error);
    }
    await new AuditRepository(this.env.DB).enrichByRequest(input.storeId, input.requestId, {
      actorUserId: input.actorId,
      actorSessionId: input.actorSessionId ?? null,
      deviceId: input.deviceId ?? null,
      requestId: input.requestId,
    });
    return { orderId: input.orderId, cancelled: true };
  }

  async listInvoices(storeId: string) {
    const result = await this.repository.listInvoices(storeId, 100);
    return result.results;
  }

  async getInvoice(storeId: string, invoiceId: string) {
    const result = await this.repository.getInvoice(storeId, invoiceId);
    if (!result.invoice) throw new AppError('INVOICE_NOT_FOUND', 'Không tìm thấy phiếu.', 404);
    return result;
  }

  async getOrderDetail(
    storeId: string,
    orderId: string,
    now = Date.now(),
  ): Promise<OrderDetailDto> {
    const orderRaw = await this.repository.findOrderDetailRaw(storeId, orderId);
    if (!orderRaw) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.', 404);

    const isTakeaway = orderRaw.order_type === 'TAKEAWAY';

    // 1. Time session & multi-segment calculation
    let timeSummary: OrderDetailDto['timeSummary'] = null;
    const timeSegments: OrderTimeSegmentDetail[] = [];
    let tableUsageChain: string[] = [];

    if (!isTakeaway) {
      const session = await this.repository.findTimeSession(storeId, orderId);
      const segmentsRaw = await this.repository.listOrderTimeSegmentsDetail(storeId, orderId);
      const pausesRaw = session ? await this.repository.listPauses(storeId, session.id) : null;
      const sessionPauses = pausesRaw
        ? pausesRaw.results.map((p) => ({
            pausedAtMs: p.pausedAtMs,
            resumedAtMs: p.resumedAtMs ?? now,
          }))
        : [];

      if (segmentsRaw.results.length > 0) {
        let totalElapsedSeconds = 0;
        let totalAmountBeforeRoundingVnd = 0;
        let totalAmountAfterRoundingVnd = 0;

        for (let i = 0; i < segmentsRaw.results.length; i++) {
          const seg = segmentsRaw.results[i]!;
          const isFirst = i === 0;
          const isLast = i === segmentsRaw.results.length - 1;

          const segStarted = isFirst ? (session?.started_at ?? seg.startedAt) : seg.startedAt;
          let segEnded: number;

          if (seg.endedAt !== null) {
            segEnded = Math.max(segStarted + 1, seg.endedAt);
          } else if (orderRaw.status === 'PAYMENT_PENDING' || orderRaw.status === 'PAID') {
            segEnded = Math.max(segStarted + 1, session?.ended_at ?? orderRaw.closed_at ?? now);
          } else if (orderRaw.status === 'CANCELLED') {
            segEnded = Math.max(segStarted + 1, session?.ended_at ?? orderRaw.cancelled_at ?? now);
          } else {
            segEnded = Math.max(segStarted + 1, isLast ? now : (session?.ended_at ?? now));
          }

          let segConfig: PricingConfigSnapshot;
          try {
            segConfig = JSON.parse(seg.pricingSnapshotJson) as PricingConfigSnapshot;
          } catch {
            segConfig = {
              version: seg.pricingVersion,
              timezone: this.env.STORE_TIMEZONE,
              basePriceVnd: seg.unitPriceSnapshot,
              baseDurationSeconds: 3600,
              calculationMode: 'ACTUAL_TIME',
              roundingUnitVnd: 1000,
              firstPeriod: { enabled: false },
              specialWindows: [],
            };
          }

          const segPauses = sessionPauses.filter(
            (p) => p.resumedAtMs > segStarted && p.pausedAtMs < segEnded,
          );

          const segPricing = calculateTimePrice({
            startedAtMs: segStarted,
            endedAtMs: segEnded,
            pauses: segPauses,
            config: segConfig,
          });

          totalElapsedSeconds += segPricing.elapsedSeconds;
          totalAmountBeforeRoundingVnd += segPricing.amountBeforeRoundingVnd;
          totalAmountAfterRoundingVnd += segPricing.amountAfterRoundingVnd;

          const isCurrentActive = seg.endedAt === null && orderRaw.status === 'OPEN';

          timeSegments.push({
            id: seg.id,
            tableId: seg.tableId,
            tableName: seg.tableName,
            areaName: seg.areaName,
            timeProductId: seg.timeProductId,
            rateNameSnapshot: seg.rateNameSnapshot,
            startedAt: segStarted,
            endedAt: seg.endedAt !== null || orderRaw.status !== 'OPEN' ? segEnded : null,
            elapsedSeconds: segPricing.elapsedSeconds,
            unitPriceSnapshot: seg.unitPriceSnapshot || segConfig.basePriceVnd,
            billingUnit: 'đ/giờ',
            amountBeforeRoundingVnd: segPricing.amountBeforeRoundingVnd,
            amountAfterRoundingVnd: segPricing.amountAfterRoundingVnd,
            pricingRuleSnapshot: segConfig,
            isCurrentActive,
          });
        }

        timeSummary = {
          totalElapsedSeconds,
          totalAmountBeforeRoundingVnd,
          totalAmountAfterRoundingVnd,
          isRealtime: orderRaw.status === 'OPEN',
          status: session?.status ?? (orderRaw.status === 'OPEN' ? 'RUNNING' : 'ENDED'),
        };

        tableUsageChain = timeSegments.reduce<string[]>((acc, s) => {
          if (acc.length === 0 || acc[acc.length - 1] !== s.tableName) {
            acc.push(s.tableName);
          }
          return acc;
        }, []);
      } else if (session) {
        let pricingConfig: PricingConfigSnapshot;
        try {
          pricingConfig = JSON.parse(session.pricing_snapshot_json) as PricingConfigSnapshot;
        } catch {
          pricingConfig = {
            version: session.pricing_version,
            timezone: this.env.STORE_TIMEZONE,
            basePriceVnd: 0,
            baseDurationSeconds: 3600,
            calculationMode: 'ACTUAL_TIME',
            roundingUnitVnd: 1000,
            firstPeriod: { enabled: false },
            specialWindows: [],
          };
        }

        const effectiveEndedAt =
          orderRaw.status === 'OPEN'
            ? now
            : (session.ended_at ?? orderRaw.closed_at ?? orderRaw.cancelled_at ?? now);

        const singlePricing = calculateTimePrice({
          startedAtMs: session.started_at,
          endedAtMs: Math.max(session.started_at + 1, effectiveEndedAt),
          pauses: sessionPauses,
          config: pricingConfig,
        });

        timeSegments.push({
          id: session.id,
          tableId: session.table_id,
          tableName: orderRaw.table_name ?? 'Bàn',
          areaName: orderRaw.area_name,
          timeProductId: session.time_product_id,
          rateNameSnapshot: 'Giá tính giờ',
          startedAt: session.started_at,
          endedAt: orderRaw.status !== 'OPEN' ? effectiveEndedAt : null,
          elapsedSeconds: singlePricing.elapsedSeconds,
          unitPriceSnapshot: pricingConfig.basePriceVnd,
          billingUnit: 'đ/giờ',
          amountBeforeRoundingVnd: singlePricing.amountBeforeRoundingVnd,
          amountAfterRoundingVnd: singlePricing.amountAfterRoundingVnd,
          pricingRuleSnapshot: pricingConfig,
          isCurrentActive: orderRaw.status === 'OPEN',
        });

        timeSummary = {
          totalElapsedSeconds: singlePricing.elapsedSeconds,
          totalAmountBeforeRoundingVnd: singlePricing.amountBeforeRoundingVnd,
          totalAmountAfterRoundingVnd: singlePricing.amountAfterRoundingVnd,
          isRealtime: orderRaw.status === 'OPEN',
          status: session.status,
        };

        if (orderRaw.table_name) tableUsageChain = [orderRaw.table_name];
      }
    }

    // 2. Table transfers
    const transfersRaw = isTakeaway
      ? { results: [] }
      : await this.repository.listOrderTableTransfers(storeId, orderId);

    const tableTransfers: OrderTableTransferDetail[] = transfersRaw.results.map((tr) => {
      const prevSeg = timeSegments.find((s) => s.startedAt < tr.transferredAt);
      const oldRateVnd = prevSeg ? prevSeg.unitPriceSnapshot : tr.newRateVnd;
      return {
        id: tr.id,
        fromTableId: tr.fromTableId,
        fromTableName: tr.fromTableName,
        toTableId: tr.toTableId,
        toTableName: tr.toTableName,
        transferredAt: tr.transferredAt,
        employeeId: tr.employeeId,
        employeeName: tr.employeeName,
        oldRateVnd,
        newRateVnd: tr.newRateVnd,
        reason: null,
      };
    });

    // 3. Rate changes
    const rateChanges: OrderRateChangeDetail[] = [];
    if (timeSegments.length > 1) {
      for (let i = 1; i < timeSegments.length; i++) {
        const prev = timeSegments[i - 1]!;
        const curr = timeSegments[i]!;
        if (prev.tableId === curr.tableId && prev.unitPriceSnapshot !== curr.unitPriceSnapshot) {
          rateChanges.push({
            id: curr.id,
            tableName: curr.tableName,
            oldRateVnd: prev.unitPriceSnapshot,
            newRateVnd: curr.unitPriceSnapshot,
            appliedAt: curr.startedAt,
            employeeName: orderRaw.opened_by_name ?? 'Nhân viên',
            reason: null,
          });
        }
      }
    }

    // 4. Order items
    const itemsRaw = await this.repository.listOrderItemsWithActors(storeId, orderId, isTakeaway);
    const items: OrderItemDetail[] = await Promise.all(
      itemsRaw.results.map(async (item) => {
        let gross = item.grossLineTotalVnd;
        let net = item.netLineTotalVnd;
        let discount = item.discountAmountVnd;
        let qty = item.quantityMilli;

        if (item.productType === 'TIME' && item.timeStartedAtMs) {
          const productPricing = await this.productPricingSnapshot(storeId, item.productId);
          if (productPricing) {
            const startedAt = item.timeStartedAtMs;
            const endedAt = item.timeEndedAtMs ?? (orderRaw.status === 'OPEN' ? now : startedAt);
            const timeCalc = calculateTimePrice({
              startedAtMs: startedAt,
              endedAtMs: Math.max(startedAt + 1000, endedAt),
              config: productPricing,
            });
            qty = Math.max(1, Math.round((timeCalc.elapsedSeconds / 3600) * 1000));
            gross = timeCalc.amountAfterRoundingVnd;
            discount =
              item.discountType === 'PERCENT'
                ? Math.min(gross, Math.round((gross * (item.discountInputValue ?? 0)) / 100))
                : item.discountType === 'FIXED'
                  ? Math.min(gross, item.discountInputValue ?? 0)
                  : 0;
            net = gross - discount;
          }
        }

        return {
          id: item.id,
          productId: item.productId,
          variantId: item.variantId,
          productType: item.productType,
          productNameSnapshot: item.productNameSnapshot,
          variantNameSnapshot: item.variantNameSnapshot,
          unitNameSnapshot: item.unitNameSnapshot,
          unitPriceSnapshot: item.unitPriceSnapshot,
          quantityMilli: qty,
          grossLineTotalVnd: gross,
          discountType: item.discountType,
          discountInputValue: item.discountInputValue,
          discountAmountVnd: discount,
          discountReason: item.discountReason,
          netLineTotalVnd: net,
          note: item.note,
          addedById: item.addedById,
          addedByName: item.addedByName,
          addedAt: item.addedAt,
          timeStartedAtMs: item.timeStartedAtMs,
          timeEndedAtMs: item.timeEndedAtMs,
        };
      }),
    );

    // 5. Checkout / Stop Time / Resume
    const stopResume = isTakeaway
      ? { stops: [], resumes: [] }
      : await this.repository.listOrderStopAndResumeCommands(storeId, orderId);

    let checkout: OrderDetailDto['checkout'] = null;
    if (stopResume.stops.length > 0) {
      const lastStop = stopResume.stops[stopResume.stops.length - 1]!;
      const lastResume =
        stopResume.resumes.length > 0 ? stopResume.resumes[stopResume.resumes.length - 1]! : null;

      const frozenTimeAmount = timeSummary?.totalAmountAfterRoundingVnd ?? 0;
      const frozenItemsAmount = items.reduce((sum, it) => sum + it.netLineTotalVnd, 0);

      checkout = {
        stoppedAt: lastStop.stoppedAt,
        status: orderRaw.status === 'PAYMENT_PENDING' ? 'CHECKOUT_PENDING' : null,
        frozenElapsedSeconds: timeSummary?.totalElapsedSeconds ?? null,
        frozenTimeAmountVnd: frozenTimeAmount,
        frozenItemsAmountVnd: frozenItemsAmount,
        frozenTotalVnd: frozenTimeAmount + frozenItemsAmount,
        stoppedByName: lastStop.actorName,
        resumedAt: lastResume ? lastResume.resumedAt : null,
        resumedByName: lastResume ? lastResume.actorName : null,
      };
    }

    // 6. Payments
    const paymentsRaw = await this.repository.listOrderPaymentsDetail(storeId, orderId, isTakeaway);
    const payments = paymentsRaw.results.map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      amount: p.amount,
      cashReceived: p.cashReceived,
      cashChange: p.cashChange,
      transactionRef: p.transactionRef,
      createdById: p.createdById,
      createdByName: p.createdByName ?? 'Thu ngân',
      createdAt: p.createdAt,
    }));

    // 7. Invoice
    const invoiceRaw = await this.repository.findOrderInvoiceDetail(storeId, orderId, isTakeaway);
    const invoice = invoiceRaw
      ? {
          id: invoiceRaw.id,
          displayCode: invoiceRaw.displayCode,
          status: invoiceRaw.status,
          issuedAt: invoiceRaw.issuedAt,
          issuedById: invoiceRaw.issuedById,
          issuedByName: invoiceRaw.issuedByName ?? 'Thu ngân',
          subtotalVnd: invoiceRaw.subtotalVnd,
          discountTotalVnd: invoiceRaw.discountTotalVnd,
          totalVnd: invoiceRaw.totalVnd,
          snapshotJson: invoiceRaw.snapshotJson,
        }
      : null;
    const paymentAllocations = invoice
      ? (await this.repository.listInvoicePaymentAllocations(storeId, invoice.id)).results
      : [];

    // 8. Audit logs & timeline
    const auditLogsRaw = await this.repository.listOrderAuditLogsDetail(storeId, orderId);
    const auditEvents: OrderAuditEventDetail[] = auditLogsRaw.results.map((log) => {
      let afterObj: Record<string, unknown> = {};
      let beforeObj: Record<string, unknown> = {};
      try {
        if (log.afterJson) afterObj = JSON.parse(log.afterJson) as Record<string, unknown>;
      } catch {
        /* empty */
      }
      try {
        if (log.beforeJson) beforeObj = JSON.parse(log.beforeJson) as Record<string, unknown>;
      } catch {
        /* empty */
      }

      const actor = log.actorName ?? 'Nhân viên';
      let title = log.action;
      let description = `${actor} thực hiện thao tác`;

      switch (log.action) {
        case 'TABLE_OPENED':
          title = 'Mở bàn';
          description = `${actor} mở ${orderRaw.table_name ?? 'bàn'}`;
          break;
        case 'ORDER_CREATED':
          title = 'Tạo đơn mang đi';
          description = `${actor} tạo đơn mang đi`;
          break;
        case 'ORDER_ITEM_ADDED':
          title = 'Thêm mặt hàng';
          description = `${actor} thêm món ${String(afterObj['productName'] ?? afterObj['product_name'] ?? 'mặt hàng')}`;
          break;
        case 'ORDER_ITEM_ADDED_WITH_DISCOUNT':
          title = 'Thêm món (có giảm giá)';
          description = `${actor} thêm món có áp dụng giảm giá`;
          break;
        case 'ORDER_ITEM_UPDATED':
          title = 'Cập nhật mặt hàng';
          description = `${actor} điều chỉnh số lượng hoặc ghi chú món`;
          break;
        case 'ORDER_ITEM_REMOVED':
          title = 'Xóa mặt hàng';
          description = `${actor} xóa món khỏi đơn`;
          break;
        case 'TIME_SESSION_REMOVED':
          title = 'Xóa tiền giờ';
          description = `${actor} xóa tiền giờ của đơn`;
          break;
        case 'TABLE_TRANSFERRED': {
          const fromName =
            tableTransfers.find((t) => t.transferredAt === log.eventAt)?.fromTableName ??
            'bàn trước';
          const toName =
            tableTransfers.find((t) => t.transferredAt === log.eventAt)?.toTableName ?? 'bàn mới';
          title = 'Chuyển bàn';
          description = `${actor} chuyển từ ${fromName} sang ${toName}`;
          break;
        }
        case 'TIME_PAUSED':
          title = 'Tạm dừng tính giờ';
          description = `${actor} tạm dừng tính giờ bàn`;
          break;
        case 'TIME_RESUMED':
          title = 'Tiếp tục tính giờ';
          description = `${actor} tiếp tục tính giờ bàn`;
          break;
        case 'TIME_RANGE_UPDATED':
          title = 'Điều chỉnh giờ chơi';
          description = `${actor} cập nhật lại khoảng thời gian chơi`;
          break;
        case 'ORDER_CHECKOUT_PENDING':
          title = 'Dừng giờ để thanh toán';
          description = `${actor} dừng tính giờ, chốt thời gian thanh toán`;
          break;
        case 'ORDER_RESUMED_FROM_CHECKOUT':
          title = 'Tiếp tục chơi';
          description = `${actor} xác nhận khách tiếp tục chơi`;
          break;
        case 'CHECKOUT_COMPLETED':
          title = 'Thanh toán thành công';
          description = `${actor} hoàn tất thanh toán hóa đơn`;
          break;
        case 'ORDER_CANCELLED':
          title = 'Hủy đơn hàng';
          description = `${actor} hủy đơn hàng (Lý do: ${String(afterObj['reason'] ?? orderRaw.cancel_reason ?? 'Không có')})`;
          break;
        case 'ORDER_NOTE_UPDATED':
          title = 'Cập nhật ghi chú';
          description = `${actor} cập nhật ghi chú đơn hàng`;
          break;
        default:
          title = log.action;
          description = `${actor} thực hiện ${log.action}`;
      }

      return {
        id: log.id,
        action: log.action,
        title,
        description,
        eventAt: log.eventAt,
        actorId: log.actorId,
        actorName: log.actorName,
        before: beforeObj,
        after: afterObj,
        metadata: null,
      };
    });

    // 9. Base totals calculation
    const timeAmountVnd = timeSummary?.totalAmountAfterRoundingVnd ?? 0;
    const itemGrossAmountVnd = items.reduce((sum, it) => sum + it.grossLineTotalVnd, 0);
    const itemDiscountAmountVnd = items.reduce((sum, it) => sum + it.discountAmountVnd, 0);

    // 8.5. Promotions calculation
    let appliedPromotions: OrderAppliedPromotionDetail[] = [];
    if (invoice?.snapshotJson) {
      try {
        const snap = JSON.parse(invoice.snapshotJson) as {
          promotions?: OrderAppliedPromotionDetail[];
          promotion?: OrderAppliedPromotionDetail;
        };
        appliedPromotions = snap.promotions ?? (snap.promotion ? [snap.promotion] : []);
      } catch {
        appliedPromotions = [];
      }
    } else {
      try {
        const promoResult = await new PromotionService(this.env).optionsForOrder({
          storeId,
          orderId,
          subtotalVnd: Math.max(0, timeAmountVnd + itemGrossAmountVnd - itemDiscountAmountVnd),
          customerId: orderRaw.customer_id ?? null,
          items: items.map((it) => ({
            productId: it.productId,
            variantId: it.variantId,
            productType: it.productType,
            productName: it.productNameSnapshot,
            variantName: it.variantNameSnapshot,
            unitPriceVnd: it.unitPriceSnapshot,
            quantityMilli: it.quantityMilli,
            grossLineTotalVnd: it.grossLineTotalVnd,
            netLineTotalVnd: it.netLineTotalVnd,
          })),
          now,
        });
        appliedPromotions = promoResult.applied.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          scope: p.scope,
          value: p.value,
          discountAmountVnd: p.discountAmountVnd,
          giftItems: p.giftItems,
          flatPriceItems: p.flatPriceItems,
        }));
      } catch {
        appliedPromotions = [];
      }
    }

    const promotionDiscountAmountVnd = appliedPromotions.reduce(
      (sum, p) => sum + (p.discountAmountVnd || 0),
      0,
    );
    const orderDiscountAmountVnd = promotionDiscountAmountVnd;

    let subtotalVnd = timeAmountVnd + itemGrossAmountVnd;
    let totalDiscountVnd = itemDiscountAmountVnd + orderDiscountAmountVnd;
    let totalVnd = Math.max(0, subtotalVnd - totalDiscountVnd);

    // If order is PAID with snapshot, use authoritative invoice numbers
    if (invoice) {
      subtotalVnd = invoice.subtotalVnd;
      totalDiscountVnd = invoice.discountTotalVnd;
      totalVnd = invoice.totalVnd;
    }

    const paidAmountVnd = paymentAllocations.length
      ? paymentAllocations
          .filter((allocation) => allocation.method !== 'DEBT')
          .reduce((sum, allocation) => sum + allocation.amountVnd, 0)
      : payments.filter((p) => p.status === 'SUCCEEDED').reduce((sum, p) => sum + p.amount, 0);
    const debtAmountVnd = paymentAllocations
      .filter((allocation) => allocation.method === 'DEBT')
      .reduce((sum, allocation) => sum + allocation.amountVnd, 0);

    const changeAmountVnd =
      payments.find((p) => p.cashChange !== null && p.cashChange !== undefined)?.cashChange ?? 0;

    return {
      order: {
        id: orderRaw.id,
        displayCode: orderRaw.display_code,
        orderType: orderRaw.order_type,
        status: orderRaw.status,
        version: orderRaw.version,
        storeId: orderRaw.store_id,
        storeName: orderRaw.store_name,
        tableId: orderRaw.table_id,
        tableName: orderRaw.table_name,
        areaId: orderRaw.area_id,
        areaName: orderRaw.area_name,
        tableUsageChain,
        openedAt: orderRaw.opened_at,
        openedById: orderRaw.opened_by_id,
        openedByName: orderRaw.opened_by_name ?? 'Nhân viên',
        closedAt: orderRaw.closed_at,
        cancelledAt: orderRaw.cancelled_at,
        cancelReason: orderRaw.cancel_reason,
        cancelledByName: orderRaw.cancelled_by_name,
        note: orderRaw.note,
      },
      customer: {
        name: orderRaw.customer_name ?? 'Khách lẻ',
        phone: orderRaw.customer_phone ?? null,
      },
      timeSummary,
      timeSegments,
      tableTransfers,
      rateChanges,
      items,
      checkout,
      payments,
      paymentAllocations,
      invoice,
      promotions: appliedPromotions,
      auditEvents,
      totals: {
        timeAmountVnd,
        itemGrossAmountVnd,
        itemDiscountAmountVnd,
        orderDiscountAmountVnd,
        subtotalVnd,
        totalDiscountVnd,
        totalVnd,
        paidAmountVnd,
        changeAmountVnd,
        debtAmountVnd,
      },
    };
  }
}
