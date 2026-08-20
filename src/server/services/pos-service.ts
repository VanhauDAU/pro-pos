import type { PricingConfigSnapshot } from '@domain/pricing/types';
import { calculateTimePrice } from '@domain/pricing/engine';
import { AppError } from '@server/lib/app-error';
import { PosRepository } from '@server/repositories/pos-repository';
import { AuditRepository } from '@server/repositories/audit-repository';

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

  async listTables(storeId: string) {
    const result = await this.repository.listTables(storeId);
    return result.results;
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
    try {
      await this.repository.executeOpenTable({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        tableId: input.tableId,
        expectedTableVersion: input.expectedTableVersion,
        orderId,
        timeSessionId,
        pricingSnapshotJson: JSON.stringify(pricing.config),
        pricingVersion: pricing.config.version,
        actorId: input.actorId,
        requestId: input.requestId,
        issuedAt: Date.now(),
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
    return { orderId, timeSessionId, tableId: input.tableId };
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
    expectedOrderVersion: number;
    discount: null | { type: 'FIXED' | 'PERCENT'; value: number };
    actorSessionId?: string | null;
    deviceId?: string | null;
  }) {
    const replay = await this.repository.findAddItemCommand(input.storeId, input.idempotencyKey);
    if (replay) return replay;
    const product = await this.repository.findSaleVariant(
      input.storeId,
      input.productId,
      input.variantId,
    );
    if (
      !product ||
      product.product_status !== 'ACTIVE' ||
      product.product_type === 'TIME' ||
      product.variant_status !== 'ACTIVE' ||
      (product.prompt_price !== 1 && product.sale_price === null)
    ) {
      throw new AppError('PRODUCT_NOT_AVAILABLE', 'Mặt hàng không khả dụng.', 422);
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
    const unitPriceVnd =
      product.prompt_price === 1 ? input.enteredUnitPriceVnd! : product.sale_price!;
    const subtotal = Math.floor((unitPriceVnd * input.quantityMilli + 500) / 1000);
    let discountAmount = 0;
    if (input.discount) {
      if (input.discount.type === 'PERCENT') {
        if (input.discount.value > 100) {
          throw new AppError('DISCOUNT_INVALID', 'Phần trăm giảm giá không hợp lệ.', 422);
        }
        discountAmount = Math.floor((subtotal * input.discount.value + 50) / 100);
      } else {
        discountAmount = input.discount.value;
      }
    }
    discountAmount = Math.min(subtotal, discountAmount);
    const itemId = crypto.randomUUID();
    try {
      await this.repository.executeAddItem({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderId: input.orderId,
        expectedOrderVersion: input.expectedOrderVersion,
        itemId,
        productId: product.product_id,
        variantId: product.variant_id,
        productType: product.product_type,
        productName: product.product_name,
        variantName: product.variant_name,
        unitName: product.unit_name,
        unitPriceVnd,
        quantityMilli: input.quantityMilli,
        discountType: input.discount?.type ?? null,
        discountInputValue: input.discount?.value ?? null,
        discountAmountVnd: discountAmount,
        grossLineTotalVnd: subtotal,
        netLineTotalVnd: subtotal - discountAmount,
        actorId: input.actorId,
        requestId: input.requestId,
        issuedAt: Date.now(),
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
        variantId: product.variant_id,
        unitPriceVnd,
        quantityMilli: input.quantityMilli,
        discountType: input.discount?.type ?? null,
        discountInputValue: input.discount?.value ?? null,
        discountAmountVnd: discountAmount,
        grossLineTotalVnd: subtotal,
        netLineTotalVnd: subtotal - discountAmount,
      },
      now: Date.now(),
    });
    return { itemId, orderId: input.orderId };
  }

  async quote(storeId: string, orderId: string, now = Date.now()) {
    const order = await this.repository.findOrder(storeId, orderId);
    const session = await this.repository.findTimeSession(storeId, orderId);
    if (!order || !session) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);
    const pauses = await this.repository.listPauses(storeId, session.id);
    const items = await this.repository.listOrderItems(storeId, orderId);
    const pricing = calculateTimePrice({
      startedAtMs: session.started_at,
      endedAtMs: session.ended_at ?? now,
      pauses: pauses.results.map((pause) => ({
        pausedAtMs: pause.pausedAtMs,
        resumedAtMs: pause.resumedAtMs ?? now,
      })),
      config: JSON.parse(session.pricing_snapshot_json) as PricingConfigSnapshot,
    });
    const productGross = items.results.reduce(
      (sum, item) => sum + Number(item.grossLineTotalVnd),
      0,
    );
    const discountTotal = items.results.reduce(
      (sum, item) => sum + Number(item.discountAmountVnd),
      0,
    );
    const subtotal = productGross + pricing.amountAfterRoundingVnd;
    return {
      order: {
        id: order.id,
        tableId: order.table_id,
        tableName: order.table_name,
        status: order.status,
        version: order.version,
      },
      items: items.results,
      time: pricing,
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
    const replay = await this.repository.findCheckoutCommand(input.storeId, input.idempotencyKey);
    if (replay) return replay;
    const quote = await this.quote(input.storeId, input.orderId);
    if (quote.order.status !== 'OPEN') {
      throw new AppError('ORDER_NOT_OPEN', 'Đơn hàng không ở trạng thái mở.', 409);
    }
    if (quote.order.version !== input.expectedOrderVersion) {
      throw new AppError('ORDER_VERSION_CONFLICT', 'Đơn hàng đã thay đổi. Vui lòng tải lại.', 409);
    }
    const cashReceived = input.method === 'CASH' ? input.cashReceivedVnd : null;
    if (input.method === 'CASH' && (cashReceived === null || cashReceived < quote.totalVnd)) {
      throw new AppError('INSUFFICIENT_CASH', 'Tiền khách đưa không đủ.', 422);
    }
    const now = input.now ?? Date.now();
    const invoiceId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const numbering = await this.repository.findInvoiceNumberingSettings(input.storeId);
    if (!numbering) throw new AppError('STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.', 404);
    const businessDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: numbering.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date(now - numbering.cutoffMinutes * 60_000))
      .replaceAll('-', '');
    const invoiceSnapshot = {
      order: quote.order,
      items: quote.items,
      time: quote.time,
      totals: {
        subtotalVnd: quote.subtotalVnd,
        discountTotalVnd: quote.discountTotalVnd,
        totalVnd: quote.totalVnd,
      },
      issuedAt: now,
    };
    try {
      await this.repository.executeCheckout({
        idempotencyKey: input.idempotencyKey,
        storeId: input.storeId,
        orderId: input.orderId,
        tableId: quote.order.tableId,
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
        timeDescription: `Tiền giờ ${quote.order.tableName}`,
        timeElapsedSeconds: quote.time.elapsedSeconds,
        timeAmount: quote.time.amountAfterRoundingVnd,
        timeSnapshotJson: JSON.stringify(quote.time),
        invoiceSnapshotJson: JSON.stringify(invoiceSnapshot),
        actorId: input.actorId,
        requestId: input.requestId,
        issuedAt: now,
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
    const completed = await this.repository.findCheckoutCommand(
      input.storeId,
      input.idempotencyKey,
    );
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
    const replay = await this.repository.findCancelCommand(input.storeId, input.idempotencyKey);
    if (replay) return { ...replay, cancelled: true };
    const order = await this.repository.findOrder(input.storeId, input.orderId);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn.', 404);
    try {
      await this.repository.executeCancel({
        commandId: input.idempotencyKey,
        storeId: input.storeId,
        orderId: input.orderId,
        tableId: order.table_id,
        expectedOrderVersion: input.expectedOrderVersion,
        reason: input.reason.trim(),
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
