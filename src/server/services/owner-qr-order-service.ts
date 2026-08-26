import type {
  OwnerQrOrderSettingsDto,
  OwnerQrTableDto,
  QuickReasonInput,
  QrQuickReasonDto,
  UpdateOwnerQrOrderSettingsInput,
} from '@contracts/owner-qr-order';
import { AppError } from '@server/lib/app-error';
import { calculateQrSalesAvailability } from '@server/lib/qr-sales';
import { AuditRepository, type AuditContext } from '@server/repositories/audit-repository';
import { OwnerQrOrderRepository } from '@server/repositories/owner-qr-order-repository';
import { QrOrderRepository } from '@server/repositories/qr-order-repository';

export class OwnerQrOrderService {
  private readonly repository: OwnerQrOrderRepository;
  private readonly qrRepository: QrOrderRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new OwnerQrOrderRepository(env.DB);
    this.qrRepository = new QrOrderRepository(env.DB);
  }

  async getSettings(storeId: string): Promise<OwnerQrOrderSettingsDto> {
    const [settings, salesHours] = await Promise.all([
      this.repository.getSettings(storeId),
      this.repository.listSalesHours(storeId),
    ]);
    if (!settings) throw new AppError('STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.', 404);
    const availability = calculateQrSalesAvailability({
      timeZone: settings.timezone,
      scheduleEnabled: settings.salesScheduleEnabled === 1,
      manuallyPaused: settings.salesPaused === 1,
      windows: salesHours.results,
    });
    return {
      timezone: settings.timezone,
      locationVerificationEnabled: settings.locationVerificationEnabled === 1,
      latitude: settings.latitude,
      longitude: settings.longitude,
      allowedRadiusMeters: settings.allowedRadiusMeters,
      maxAccuracyMeters: settings.maxAccuracyMeters,
      locationMemoryMinutes: settings.locationMemoryMinutes,
      orderCooldownSeconds: settings.orderCooldownSeconds,
      callStaffCooldownSeconds: settings.callStaffCooldownSeconds,
      checkoutCooldownSeconds: settings.checkoutCooldownSeconds,
      salesScheduleEnabled: settings.salesScheduleEnabled === 1,
      salesPaused: settings.salesPaused === 1,
      salesPausedAt: settings.salesPausedAt,
      salesHours: salesHours.results,
      availability,
    };
  }

  async updateSettings(input: {
    storeId: string;
    values: UpdateOwnerQrOrderSettingsInput;
    auditContext: AuditContext;
  }) {
    const before = await this.getSettings(input.storeId);
    const invalidateLocations =
      before.locationVerificationEnabled !== input.values.locationVerificationEnabled ||
      before.latitude !== input.values.latitude ||
      before.longitude !== input.values.longitude ||
      before.allowedRadiusMeters !== input.values.allowedRadiusMeters ||
      before.maxAccuracyMeters !== input.values.maxAccuracyMeters;
    const now = Date.now();
    await this.repository.updateSettings({
      storeId: input.storeId,
      values: input.values,
      invalidateLocations,
      now,
    });
    const after = await this.getSettings(input.storeId);
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: input.auditContext,
      action: 'QR_ORDER_SETTINGS_UPDATED',
      entityType: 'QR_ORDER_SETTINGS',
      entityId: input.storeId,
      before,
      after,
      now,
    });
    return after;
  }

  async setSalesPaused(input: { storeId: string; paused: boolean; auditContext: AuditContext }) {
    const before = await this.getSettings(input.storeId);
    const now = Date.now();
    await this.repository.setSalesPaused(input.storeId, input.paused, now);
    const after = await this.getSettings(input.storeId);
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: input.auditContext,
      action: input.paused ? 'QR_ORDER_SALES_PAUSED' : 'QR_ORDER_SALES_RESUMED',
      entityType: 'QR_ORDER_SETTINGS',
      entityId: input.storeId,
      before: { paused: before.salesPaused },
      after: { paused: after.salesPaused, availability: after.availability },
      now,
    });
    return after;
  }

  async listTables(storeId: string): Promise<OwnerQrTableDto[]> {
    const result = await this.repository.listTables(storeId);
    return result.results.map((table) => ({
      id: table.id,
      name: table.name,
      status: table.status,
      areaId: table.areaId,
      areaName: table.areaName,
      qrOrderEnabled: table.qrOrderEnabled === 1,
      qrExists: Boolean(table.publicToken),
      qrPath: table.publicToken ? `/q/${table.publicToken}` : null,
    }));
  }

  async setTableEnabled(input: {
    storeId: string;
    tableId: string;
    enabled: boolean;
    auditContext: AuditContext;
  }) {
    const table = await this.repository.findTable(input.storeId, input.tableId);
    if (!table) throw new AppError('TABLE_NOT_FOUND', 'Không tìm thấy bàn/phòng.', 404);
    if (!input.enabled && table.status === 'OCCUPIED') {
      throw new AppError(
        'QR_ORDER_TABLE_OCCUPIED',
        'Không thể tắt QR Order khi bàn đang phục vụ.',
        409,
      );
    }
    const now = Date.now();
    await this.repository.setTableQrEnabled(input.storeId, input.tableId, input.enabled, now);
    if (!input.enabled) {
      await this.qrRepository.revokeGuestSessionsByTable(input.storeId, input.tableId);
    }
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: input.auditContext,
      action: input.enabled ? 'TABLE_QR_ORDER_ENABLED' : 'TABLE_QR_ORDER_DISABLED',
      entityType: 'SERVICE_TABLE',
      entityId: input.tableId,
      before: { enabled: table.qrOrderEnabled === 1 },
      after: { enabled: input.enabled },
      now,
    });
    return { id: input.tableId, enabled: input.enabled };
  }

  async setTablesEnabled(input: {
    storeId: string;
    tableIds: string[];
    enabled: boolean;
    auditContext: AuditContext;
  }) {
    const tables = await Promise.all(
      input.tableIds.map((tableId) => this.repository.findTable(input.storeId, tableId)),
    );
    if (tables.some((table) => !table)) {
      throw new AppError('TABLE_NOT_FOUND', 'Có bàn/phòng không thuộc cửa hàng.', 404);
    }
    if (!input.enabled && tables.some((table) => table?.status === 'OCCUPIED')) {
      throw new AppError(
        'QR_ORDER_TABLE_OCCUPIED',
        'Không thể tắt QR Order cho danh sách có bàn đang phục vụ.',
        409,
      );
    }
    const now = Date.now();
    await this.repository.setTablesQrEnabled(input.storeId, input.tableIds, input.enabled, now);
    if (!input.enabled) {
      await Promise.all(
        input.tableIds.map((tableId) =>
          this.qrRepository.revokeGuestSessionsByTable(input.storeId, tableId),
        ),
      );
    }
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: input.auditContext,
      action: input.enabled ? 'TABLE_QR_ORDER_BULK_ENABLED' : 'TABLE_QR_ORDER_BULK_DISABLED',
      entityType: 'SERVICE_TABLE',
      entityId: null,
      before: null,
      after: { enabled: input.enabled, tableIds: input.tableIds },
      now,
    });
    return { tableIds: input.tableIds, enabled: input.enabled };
  }

  listMenu(storeId: string) {
    return this.qrRepository.listMenu(storeId, true);
  }

  async setMenuProductEnabled(input: {
    storeId: string;
    productId: string;
    enabled: boolean;
    auditContext: AuditContext;
  }) {
    const product = await this.repository.findEligibleMenuProduct(input.storeId, input.productId);
    if (!product) {
      throw new AppError(
        'QR_MENU_PRODUCT_NOT_FOUND',
        'Mặt hàng không đủ điều kiện bán qua QR.',
        404,
      );
    }
    const now = Date.now();
    await this.repository.setMenuProductEnabled(input.storeId, input.productId, input.enabled, now);
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: input.auditContext,
      action: input.enabled ? 'QR_MENU_PRODUCT_ENABLED' : 'QR_MENU_PRODUCT_DISABLED',
      entityType: 'PRODUCT',
      entityId: input.productId,
      before: null,
      after: { qrOrderEnabled: input.enabled },
      now,
    });
    return { id: input.productId, enabled: input.enabled };
  }

  async setMenuVariantEnabled(input: {
    storeId: string;
    variantId: string;
    enabled: boolean;
    auditContext: AuditContext;
  }) {
    const variant = await this.repository.findEligibleMenuVariant(input.storeId, input.variantId);
    if (!variant) {
      throw new AppError(
        'QR_MENU_VARIANT_NOT_FOUND',
        'Phiên bản giá không đủ điều kiện bán qua QR.',
        404,
      );
    }
    const now = Date.now();
    await this.repository.setMenuVariantEnabled(input.storeId, input.variantId, input.enabled, now);
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: input.auditContext,
      action: input.enabled ? 'QR_MENU_VARIANT_ENABLED' : 'QR_MENU_VARIANT_DISABLED',
      entityType: 'PRODUCT_VARIANT',
      entityId: input.variantId,
      before: null,
      after: { qrOrderEnabled: input.enabled },
      now,
    });
    return { id: input.variantId, productId: variant.productId, enabled: input.enabled };
  }

  async listQuickReasons(storeId: string, activeOnly = false): Promise<QrQuickReasonDto[]> {
    const result = await this.repository.listQuickReasons(storeId, activeOnly);
    return result.results.map((reason) => ({
      id: reason.id,
      label: reason.label,
      enabled: reason.status === 'ACTIVE',
      sortOrder: reason.sortOrder,
    }));
  }

  async replaceQuickReasons(input: {
    storeId: string;
    reasons: QuickReasonInput[];
    auditContext: AuditContext;
  }) {
    const before = await this.listQuickReasons(input.storeId);
    const knownIds = new Set(before.map((reason) => reason.id));
    if (input.reasons.some((reason) => reason.id && !knownIds.has(reason.id))) {
      throw new AppError('QUICK_REASON_INVALID', 'Lý do gọi nhân viên không hợp lệ.', 422);
    }
    const now = Date.now();
    await this.repository.replaceQuickReasons(input.storeId, input.reasons, now);
    const after = await this.listQuickReasons(input.storeId);
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: input.auditContext,
      action: 'QR_ORDER_QUICK_REASONS_UPDATED',
      entityType: 'QR_ORDER_QUICK_REASON',
      entityId: null,
      before,
      after,
      now,
    });
    return after;
  }

  findQuickReason(storeId: string, reasonId: string) {
    return this.repository.findQuickReason(storeId, reasonId);
  }

  async getRuntimeConfig(storeId: string) {
    const [settings, quickReasons] = await Promise.all([
      this.getSettings(storeId),
      this.listQuickReasons(storeId, true),
    ]);
    return { settings, quickReasons };
  }
}
