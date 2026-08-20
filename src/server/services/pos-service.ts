import type { PricingConfigSnapshot } from '@domain/pricing/types';
import { calculateTimePrice } from '@domain/pricing/engine';
import { AppError } from '@server/lib/app-error';
import { PosRepository } from '@server/repositories/pos-repository';
import { AuditRepository } from '@server/repositories/audit-repository';

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
        timePricingConfig?: PricingConfigSnapshot | null;
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
    const list = [...products.values()];
    await Promise.all(
      list.map(async (p) => {
        if (p.productType === 'TIME') {
          p.timePricingConfig = await this.productPricingSnapshot(storeId, p.productId);
        }
      }),
    );
    return list;
  }

  getStaffContext(storeId: string, actorId: string) {
    return this.repository.getStaffContext(storeId, actorId);
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
  }) {
    const replay = await this.repository.findOpenCommand(input.storeId, input.idempotencyKey);
    if (replay) return replay;
    const pricing = await this.pricingSnapshot(input.storeId, input.tableId);
    if (pricing.row.table_status !== 'AVAILABLE') {
      throw new AppError('TABLE_NOT_AVAILABLE', 'Bàn không còn trống.', 409);
    }
    const orderId = crypto.randomUUID();
    const timeSessionId = crypto.randomUUID();
    const issuedAt = Date.now();
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
    variantId: string | null;
    enteredUnitPriceVnd?: number;
    quantityMilli: number;
    timeStartedAtMs?: number | null | undefined;
    timeEndedAtMs?: number | null | undefined;
    note?: string | null;
    expectedOrderVersion: number;
    discount: null | { type: 'FIXED' | 'PERCENT'; value: number };
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
    const itemId = crypto.randomUUID();
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
      note: input.note?.trim() || null,
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
        grossLineTotalVnd: subtotal,
        netLineTotalVnd: subtotal - discountAmount,
        note: input.note?.trim() || null,
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
    if (item.productType === 'TIME') {
      const pricingConfig = item.productId
        ? await this.productPricingSnapshot(input.storeId, item.productId)
        : null;
      if (pricingConfig) {
        const timeResult = calculateTimePrice({
          startedAtMs: effectiveStartedAt ?? now,
          endedAtMs: Math.max((effectiveStartedAt ?? now) + 1000, effectiveEndedAt ?? now),
          config: pricingConfig,
        });
        quantityMilli = Math.max(1, Math.round((timeResult.elapsedSeconds / 3600) * 1000));
      } else {
        quantityMilli = Math.max(
          1,
          Math.round(
            (((effectiveEndedAt ?? now) - (effectiveStartedAt ?? now)) / 3_600_000) * 1000,
          ),
        );
      }
    }
    try {
      await this.repository.updateOrderItem({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderType: order.order_type,
        orderId: input.orderId,
        itemId: input.itemId,
        expectedOrderVersion: input.expectedOrderVersion,
        quantityMilli,
        timeStartedAtMs: effectiveStartedAt ?? null,
        timeEndedAtMs: effectiveEndedAt ?? null,
        note: input.note?.trim() || null,
        actorId: input.actorId,
        requestId: input.requestId,
        issuedAt: now,
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
  }) {
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
        storeId: input.storeId,
        orderId: input.orderId,
        sessionId: session.id,
        expectedOrderVersion: input.expectedOrderVersion,
        reason: input.reason,
        actorId: input.actorId,
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

  async quote(storeId: string, orderId: string, now = Date.now()) {
    const order =
      (await this.repository.findOrder(storeId, orderId)) ??
      (await this.repository.findTakeawayOrder(storeId, orderId));
    const session = await this.repository.findTimeSession(storeId, orderId);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);
    const pauses = session ? await this.repository.listPauses(storeId, session.id) : null;
    const items =
      order.order_type === 'TAKEAWAY'
        ? await this.repository.listTakeawayOrderItems(storeId, orderId)
        : await this.repository.listOrderItems(storeId, orderId);
    const pricingConfig = session
      ? (JSON.parse(session.pricing_snapshot_json) as PricingConfigSnapshot)
      : null;
    const pricing =
      session && pricingConfig
        ? calculateTimePrice({
            startedAtMs: session.started_at,
            endedAtMs: Math.max(session.started_at + 1, session.ended_at ?? now),
            pauses: pauses!.results.map((pause) => ({
              pausedAtMs: pause.pausedAtMs,
              resumedAtMs: pause.resumedAtMs ?? now,
            })),
            config: pricingConfig,
          })
        : null;
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
    const subtotal = productGross + (pricing?.amountAfterRoundingVnd ?? 0);
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
      },
      items: processedItems,
      time:
        pricing && session
          ? {
              ...pricing,
              status: session.status,
              startedAtMs: session.started_at,
              endedAtMs: session.ended_at,
              pricingConfig,
            }
          : null,
      subtotalVnd: subtotal,
      discountTotalVnd: discountTotal,
      totalVnd: subtotal - discountTotal,
    };
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
        actorSessionId: input.actorSessionId ?? null,
        deviceId: input.deviceId ?? null,
        now: Date.now(),
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
    const replay = await this.repository.findUpdateTimeRangeCommand(
      input.storeId,
      input.idempotencyKey,
    );
    if (replay) return replay;
    const now = input.now ?? Date.now();
    const order = await this.repository.findOrder(input.storeId, input.orderId);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn tại chỗ.', 404);
    const session = await this.repository.findTimeSession(input.storeId, input.orderId);
    if (!session)
      throw new AppError('ORDER_TIME_SESSION_MISSING', 'Đơn thiếu phiên tính giờ.', 409);
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

  async checkout(input: {
    storeId: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    orderId: string;
    expectedOrderVersion: number;
    method: 'CASH' | 'BANK_TRANSFER';
    cashReceivedVnd: number | null;
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
    if (quote.order.status !== 'OPEN') {
      throw new AppError('ORDER_NOT_OPEN', 'Đơn hàng không ở trạng thái mở.', 409);
    }
    if (quote.order.orderType === 'DINE_IN' && !quote.order.tableId) {
      throw new AppError('DINE_IN_ORDER_REQUIRED', 'Đơn tại chỗ thiếu thông tin bàn.', 409);
    }
    if (quote.order.version !== input.expectedOrderVersion) {
      throw new AppError('ORDER_VERSION_CONFLICT', 'Đơn hàng đã thay đổi. Vui lòng tải lại.', 409);
    }
    const cashReceived = input.method === 'CASH' ? input.cashReceivedVnd : null;
    if (input.method === 'CASH' && (cashReceived === null || cashReceived < quote.totalVnd)) {
      throw new AppError('INSUFFICIENT_CASH', 'Tiền khách đưa không đủ.', 422);
    }
    const invoiceId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const businessDay = await this.businessDay(input.storeId, now);
    const finalizedTime = quote.time
      ? { ...quote.time, status: 'ENDED' as const, endedAtMs: now }
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
    };
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
          method: input.method,
          subtotal: quote.subtotalVnd,
          discountTotal: quote.discountTotalVnd,
          total: quote.totalVnd,
          cashReceived,
          cashChange: cashReceived === null ? null : cashReceived - quote.totalVnd,
          invoiceSnapshotJson: JSON.stringify(invoiceSnapshot),
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
          method: input.method,
          subtotal: quote.subtotalVnd,
          discountTotal: quote.discountTotalVnd,
          total: quote.totalVnd,
          cashReceived,
          cashChange: cashReceived === null ? null : cashReceived - quote.totalVnd,
          timeDescription: quote.time ? `Tiền giờ ${quote.order.tableName}` : '',
          timeElapsedSeconds: quote.time?.elapsedSeconds ?? 0,
          timeAmount: quote.time?.amountAfterRoundingVnd ?? 0,
          timeSnapshotJson: finalizedTime ? JSON.stringify(finalizedTime) : '{}',
          invoiceSnapshotJson: JSON.stringify(invoiceSnapshot),
          actorId: input.actorId,
          requestId: input.requestId,
          issuedAt: now,
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
    const completed =
      (await this.repository.findCheckoutCommand(input.storeId, input.idempotencyKey)) ??
      (await this.repository.findTakeawayCheckoutCommand(input.storeId, input.idempotencyKey));
    return {
      invoiceId,
      paymentId,
      orderId: input.orderId,
      displayCode: completed!.displayCode,
      total: quote.totalVnd,
      method: input.method,
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
  }) {
    const replay = await this.repository.findTransferCommand(input.storeId, input.idempotencyKey);
    if (replay) return replay;
    const order = await this.repository.findOrder(input.storeId, input.orderId);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);
    if (order.order_type !== 'DINE_IN' || !order.table_id) {
      throw new AppError('DINE_IN_ORDER_REQUIRED', 'Chỉ đơn tại chỗ mới có thể chuyển bàn.', 422);
    }
    const [session, targetPricing] = await Promise.all([
      this.repository.findTimeSession(input.storeId, input.orderId),
      this.pricingSnapshot(input.storeId, input.targetTableId),
    ]);
    if (!session) {
      throw new AppError('ORDER_TIME_SESSION_MISSING', 'Đơn tại chỗ thiếu phiên tính giờ.', 409);
    }
    const sourceSnapshot = JSON.parse(session.pricing_snapshot_json) as PricingConfigSnapshot;
    const changesTimePrice =
      session.time_product_id !== targetPricing.row.product_id ||
      JSON.stringify(sourceSnapshot) !== JSON.stringify(targetPricing.config);
    if (changesTimePrice) {
      throw new AppError(
        'TABLE_PRICING_CHANGE_REQUIRES_SPLIT',
        'Bàn mới dùng bảng giá khác. Cần tách tiền giờ trước và sau thời điểm chuyển bàn.',
        422,
      );
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
        actorId: input.actorId,
        requestId: input.requestId,
        now: Date.now(),
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
}
