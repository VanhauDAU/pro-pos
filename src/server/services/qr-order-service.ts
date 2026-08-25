import type { SubmitGuestOrderInput } from './qr-order-types';
import type {
  GuestActiveOrderDto,
  GuestOrderContext,
  StaffNotificationAuditDto,
  StaffNotificationEventType,
  VerifyGuestLocationInput,
  VerifyGuestLocationResponse,
} from '@contracts/qr-order';
import { AppError } from '@server/lib/app-error';
import { hashOpaqueToken, randomOpaqueToken } from '@server/lib/crypto';
import { requireSecret } from '@server/lib/env';
import {
  LOCATION_VERIFICATION_SESSION_TTL_MS,
  verifyLocationCoordinates,
} from '@server/lib/location';
import {
  QrOrderRepository,
  type GuestSessionRow,
  type StaffOperationalAuditRow,
} from '@server/repositories/qr-order-repository';
import { MediaService } from '@server/services/media-service';
import { PosService } from '@server/services/pos-service';
import { StoreService } from '@server/services/store-service';

const STAFF_NOTIFICATION_RETENTION_DAYS = 3 as const;
const STAFF_NOTIFICATION_RETENTION_MS = STAFF_NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60_000;
const TABLE_OPEN_REQUEST_TTL_MS = 10 * 60_000;

function parseAuditJson(value: string | null) {
  try {
    return value ? (JSON.parse(value) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mapOperationalAudit(row: StaffOperationalAuditRow): StaffNotificationAuditDto {
  const after = parseAuditJson(row.afterJson);
  const actor = row.actorName ?? 'Nhân viên';
  const orderLabel = row.orderCode ? `đơn ${row.orderCode}` : 'đơn hàng';
  const location = row.tableName
    ? `${row.tableName}${row.areaName ? ` · ${row.areaName}` : ''}`
    : 'đơn mang đi';
  const quantity = Math.max(0, Number(after['quantityMilli'] ?? 0) / 1000);
  const totalVnd = Math.max(
    0,
    Number(after['netLineTotalVnd'] ?? after['total'] ?? after['grossLineTotalVnd'] ?? 0),
  );
  const product = [row.productName, row.variantName].filter(Boolean).join(' · ') || 'mặt hàng';
  let eventType: StaffNotificationEventType = 'ORDER_SAVED';
  let summary = `${actor} cập nhật ${orderLabel}`;
  let note = typeof after['note'] === 'string' ? after['note'] : null;

  switch (row.action) {
    case 'TABLE_OPENED':
    case 'TAKEAWAY_ORDER_CREATED':
      eventType = 'ORDER_CREATED';
      summary = `${actor} tạo ${orderLabel} tại ${location}`;
      break;
    case 'ORDER_ITEM_ADDED':
    case 'ORDER_ITEM_ADDED_WITH_DISCOUNT':
      eventType = 'ITEM_ADDED';
      summary = `${actor} thêm ${product}${quantity > 0 ? ` ×${quantity}` : ''} vào ${orderLabel} tại ${location}`;
      break;
    case 'ORDER_ITEM_UPDATED':
      eventType = 'ITEM_UPDATED';
      summary = `${actor} cập nhật ${product}${quantity > 0 ? ` thành ${quantity}` : ''} trong ${orderLabel}`;
      break;
    case 'ORDER_ITEM_REMOVED':
      eventType = 'ITEM_REMOVED';
      summary = `${actor} xóa một mặt hàng khỏi ${orderLabel}`;
      break;
    case 'ORDER_NOTE_UPDATED':
      eventType = 'ORDER_SAVED';
      summary = `${actor} lưu ghi chú cho ${orderLabel}`;
      break;
    case 'TABLE_TRANSFERRED':
      eventType = 'TABLE_TRANSFERRED';
      summary = `${actor} chuyển ${orderLabel} sang ${location}`;
      break;
    case 'TIME_PAUSED':
      eventType = 'TIME_PAUSED';
      summary = `${actor} tạm dừng tính giờ ${orderLabel} tại ${location}`;
      break;
    case 'TIME_RESUMED':
      eventType = 'TIME_RESUMED';
      summary = `${actor} tiếp tục tính giờ ${orderLabel} tại ${location}`;
      break;
    case 'TIME_RANGE_UPDATED':
    case 'TIME_SESSION_REMOVED':
    case 'TIME_SESSION_RESTORED':
      eventType = 'TIME_UPDATED';
      summary = `${actor} điều chỉnh thời gian của ${orderLabel}`;
      break;
    case 'ORDER_CHECKOUT_PENDING':
      eventType = 'CHECKOUT_PENDING';
      summary = `${actor} dừng giờ và lưu ${orderLabel} để chờ thanh toán`;
      break;
    case 'ORDER_RESUMED_FROM_CHECKOUT':
      eventType = 'TIME_RESUMED';
      summary = `${actor} mở lại ${orderLabel} và tiếp tục tính giờ`;
      break;
    case 'CHECKOUT_COMPLETED':
      eventType = 'CHECKOUT';
      summary = `${actor} thanh toán thành công ${orderLabel}${totalVnd > 0 ? ` trị giá ${totalVnd.toLocaleString('vi-VN')}đ` : ''}`;
      break;
    case 'ORDER_CANCELLED':
      eventType = 'ORDER_CANCELLED';
      summary = `${actor} hủy ${orderLabel}`;
      note = typeof after['reason'] === 'string' ? after['reason'] : note;
      break;
  }

  return {
    id: `audit:${row.id}`,
    sourceId: row.requestId,
    eventType,
    status: 'INFO',
    orderId: row.orderId ?? '',
    tableId: row.tableId ?? '',
    tableName: row.tableName ?? 'Mang đi',
    areaName: row.areaName ?? '',
    summary,
    note,
    itemCount: quantity,
    totalVnd,
    actorName: row.actorName,
    deviceName: row.deviceName,
    handledAt: row.createdAt,
    createdAt: row.createdAt,
  };
}

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const mappings: Array<[string, string, string, number]> = [
    [
      'TABLE_SESSION_NOT_ACTIVE',
      'TABLE_SESSION_NOT_ACTIVE',
      'Phiên chơi của bàn không còn hoạt động.',
      409,
    ],
    [
      'GUEST_ORDER_TOO_FAST',
      'GUEST_ORDER_TOO_FAST',
      'Vui lòng chờ vài giây trước khi gọi thêm món.',
      429,
    ],
    [
      'GUEST_ORDER_RATE_LIMITED',
      'GUEST_ORDER_RATE_LIMITED',
      'Bạn đã gửi quá nhiều yêu cầu gọi món.',
      429,
    ],
    [
      'TABLE_ORDER_RATE_LIMITED',
      'TABLE_ORDER_RATE_LIMITED',
      'Bàn đang gửi quá nhiều yêu cầu gọi món.',
      429,
    ],
    ['GUEST_IP_RATE_LIMITED', 'GUEST_IP_RATE_LIMITED', 'Có quá nhiều yêu cầu từ kết nối này.', 429],
    [
      'GUEST_ORDER_NOT_ACCEPTABLE',
      'GUEST_ORDER_NOT_ACCEPTABLE',
      'Yêu cầu đã thay đổi hoặc phiên bàn đã đóng.',
      409,
    ],
    ['GUEST_ORDER_ALREADY_DECIDED', 'GUEST_ORDER_ALREADY_DECIDED', 'Yêu cầu đã được xử lý.', 409],
  ];
  for (const [needle, code, text, status] of mappings) {
    if (message.includes(needle)) {
      throw new AppError(code, text, status as 409 | 429);
    }
  }
  if (message.includes('UNIQUE constraint failed')) {
    throw new AppError('REQUEST_ALREADY_OPEN', 'Yêu cầu này đã được gửi trước đó.', 409);
  }
  throw error;
}

type SubmitOrderResult =
  | {
      requestId: string;
      replayed: true;
      storeId: string;
      tableName: string;
    }
  | {
      requestId: string;
      replayed: false;
      storeId: string;
      tableName: string;
      areaName: string;
      orderId: string;
      createdAt: number;
      note: string | null;
      items: Array<{
        productName: string;
        variantName: string | null;
        quantity: number;
        lineTotalVnd: number;
        note: string | null;
      }>;
    };

export class QrOrderService {
  private readonly repository: QrOrderRepository;
  private readonly pepper: string;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new QrOrderRepository(env.DB);
    this.pepper = requireSecret(env.AUTH_PEPPER, 'AUTH_PEPPER');
  }

  private async contextFromSession(rawGuest: string): Promise<GuestSessionRow> {
    const session = await this.repository.findGuestSession(
      await hashOpaqueToken(rawGuest, this.pepper),
      Date.now(),
    );
    if (!session) {
      throw new AppError(
        'GUEST_SESSION_INVALID',
        'Phiên gọi món đã hết hạn. Vui lòng quét lại QR.',
        401,
      );
    }
    return session;
  }

  async getActiveOrder(
    storeId: string,
    orderId: string,
    now = Date.now(),
  ): Promise<GuestActiveOrderDto | null> {
    try {
      const posService = new PosService(this.env);
      const quote = await posService.quote(storeId, orderId, now);
      if (!quote) return null;
      return {
        id: quote.order.id,
        displayCode: quote.order.displayCode ?? quote.order.id.slice(0, 8).toUpperCase(),
        openedAt: quote.order.openedAt,
        items: quote.items.map((item) => {
          const promoGift =
            'promotionGift' in item
              ? (item.promotionGift as
                  { promotionId: string; promotionName: string } | null | undefined)
              : null;
          return {
            id: item.id,
            productName: item.productName,
            variantName: item.variantName ?? null,
            unitName: item.unitName ?? null,
            quantityMilli: item.quantityMilli,
            unitPriceVnd: item.unitPriceVnd,
            grossLineTotalVnd: item.grossLineTotalVnd,
            discountAmountVnd: item.discountAmountVnd,
            netLineTotalVnd: item.netLineTotalVnd,
            note: item.note ?? null,
            productType: item.productType,
            promotionGift: promoGift ?? null,
          };
        }),
        time: quote.time
          ? {
              status: quote.time.status,
              startedAtMs: quote.time.startedAtMs,
              endedAtMs: quote.time.endedAtMs,
              pausedAtMs: quote.time.pausedAtMs,
              elapsedSeconds: quote.time.elapsedSeconds,
              basePriceVnd: quote.time.pricingConfig.basePriceVnd,
              amountAfterRoundingVnd: quote.time.amountAfterRoundingVnd,
              segments: quote.time.segments?.map((s) => ({
                name: s.name,
                type: s.type,
                startedAtMs: s.startedAtMs,
                endedAtMs: s.endedAtMs,
                elapsedSeconds: s.elapsedSeconds,
                priceVnd: s.priceVnd,
                amountAfterRoundingVnd: s.amountBeforeRoundingVnd,
              })),
            }
          : null,
        subtotalVnd: quote.subtotalVnd,
        discountTotalVnd: quote.discountTotalVnd,
        totalVnd: Math.max(0, quote.subtotalVnd - quote.discountTotalVnd),
        calculatedAt: now,
      };
    } catch {
      return null;
    }
  }

  async getActiveOrderBySession(rawGuest: string) {
    const session = await this.contextFromSession(rawGuest);
    const order = await this.getActiveOrder(session.storeId, session.orderId);
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng của bàn.', 404);
    }
    return order;
  }

  async getActiveOrderByQr(rawQrToken: string) {
    const tokenHash = await hashOpaqueToken(rawQrToken, this.pepper);
    const context = await this.repository.findActiveQrContext(tokenHash);
    if (!context) {
      throw new AppError('QR_TABLE_SESSION_INVALID', 'Bàn hiện chưa có đơn hàng đang mở.', 404);
    }
    const order = await this.getActiveOrder(context.storeId, context.orderId);
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng của bàn.', 404);
    }
    return order;
  }

  private assertLocationVerified(session: GuestSessionRow, now = Date.now()) {
    if (session.locationVerificationEnabled !== 1) return;
    if (
      session.latitude === null ||
      session.latitude === undefined ||
      session.longitude === null ||
      session.longitude === undefined
    ) {
      throw new AppError(
        'STORE_LOCATION_NOT_CONFIGURED',
        'Cửa hàng đang bật xác minh vị trí nhưng chưa cấu hình tọa độ vị trí quán.',
        409,
      );
    }
    if (!session.locationExpiresAt || session.locationExpiresAt <= now) {
      throw new AppError(
        'LOCATION_VERIFICATION_REQUIRED',
        'Vui lòng xác minh vị trí tại quán để thực hiện thao tác này.',
        403,
        {
          required: true,
          configured: true,
          allowedRadiusMeters: session.allowedRadiusMeters,
          maxAccuracyMeters: session.maxAccuracyMeters,
        },
      );
    }
  }

  private async responseContext(session: GuestSessionRow): Promise<GuestOrderContext> {
    const now = Date.now();
    const isLocationRequired = session.locationVerificationEnabled === 1;
    const isLocationConfigured =
      session.latitude !== null &&
      session.latitude !== undefined &&
      session.longitude !== null &&
      session.longitude !== undefined;
    const isLocationVerified =
      !isLocationRequired ||
      Boolean(
        session.locationExpiresAt && session.locationExpiresAt > now && session.locationVerifiedAt,
      );

    const storeService = new StoreService(this.env);
    const [storeSettings, printSettings] = await Promise.all([
      storeService.getSettings(session.storeId),
      storeService.getPrintSettings(session.storeId),
    ]);

    return {
      tableStatus: 'OPEN',
      storeName: session.storeName,
      tableName: session.tableName,
      areaName: session.areaName,
      table: {
        id: session.tableId,
        name: session.tableName,
        areaName: session.areaName,
      },
      sessionExpiresAt: session.expiresAt,
      openRequest: null,
      locationRequirement: {
        required: isLocationRequired,
        configured: isLocationConfigured,
        allowedRadiusMeters: session.allowedRadiusMeters,
        maxAccuracyMeters: session.maxAccuracyMeters,
        isVerified: isLocationVerified,
        verifiedExpiresAt: session.locationExpiresAt ?? null,
        distanceMeters: session.locationDistanceMeters ?? null,
      },
      activeOrder: await this.getActiveOrder(session.storeId, session.orderId, now),
      menu: await this.repository.listMenu(session.storeId),
      storeInfo: storeSettings
        ? {
            name: storeSettings.name,
            phone: storeSettings.phone,
            address: storeSettings.address,
            bankName: storeSettings.bankName,
            bankAccountNumber: storeSettings.bankAccountNumber,
            bankAccountName: storeSettings.bankAccountName,
            bankQrMediaId: storeSettings.bankQrMediaId,
          }
        : null,
      printSettings,
    };
  }

  async resolveQr(input: {
    rawQrToken: string;
    rawGuest?: string;
    ip: string | null;
    deviceNonce: string | null;
  }) {
    const now = Date.now();
    const tokenHash = await hashOpaqueToken(input.rawQrToken, this.pepper);
    const tableContext = await this.repository.findQrTableContext(tokenHash);
    if (!tableContext || tableContext.tableStatus === 'DISABLED') {
      throw new AppError(
        'QR_TABLE_NOT_ACTIVE',
        'Mã QR đã bị thay đổi hoặc bàn hiện không nhận gọi món.',
        409,
      );
    }
    if (tableContext.tableStatus === 'AVAILABLE') {
      await this.repository.expireTableOpenRequests(
        tableContext.storeId,
        now - TABLE_OPEN_REQUEST_TTL_MS,
        now,
      );
      const openRequest = await this.repository.findOpenTableRequest(
        tableContext.storeId,
        tableContext.tableId,
      );
      const isLocationRequired = tableContext.locationVerificationEnabled === 1;
      const isLocationConfigured =
        tableContext.latitude !== null &&
        tableContext.latitude !== undefined &&
        tableContext.longitude !== null &&
        tableContext.longitude !== undefined;

      const storeService = new StoreService(this.env);
      const [storeSettings, printSettings] = await Promise.all([
        storeService.getSettings(tableContext.storeId),
        storeService.getPrintSettings(tableContext.storeId),
      ]);

      return {
        rawGuest: '',
        context: {
          tableStatus: openRequest ? ('OPEN_REQUESTED' as const) : ('AVAILABLE' as const),
          storeName: tableContext.storeName,
          tableName: tableContext.tableName,
          areaName: tableContext.areaName,
          table: {
            id: tableContext.tableId,
            name: tableContext.tableName,
            areaName: tableContext.areaName,
          },
          sessionExpiresAt: null,
          openRequest,
          locationRequirement: {
            required: isLocationRequired,
            configured: isLocationConfigured,
            allowedRadiusMeters: tableContext.allowedRadiusMeters,
            maxAccuracyMeters: tableContext.maxAccuracyMeters,
            isVerified: !isLocationRequired,
            verifiedExpiresAt: null,
          },
          menu: await this.repository.listMenu(tableContext.storeId),
          storeInfo: storeSettings
            ? {
                name: storeSettings.name,
                phone: storeSettings.phone,
                address: storeSettings.address,
                bankName: storeSettings.bankName,
                bankAccountNumber: storeSettings.bankAccountNumber,
                bankAccountName: storeSettings.bankAccountName,
                bankQrMediaId: storeSettings.bankQrMediaId,
              }
            : null,
          printSettings,
        },
      };
    }
    const context = await this.repository.findActiveQrContext(tokenHash);
    if (!context) {
      throw new AppError(
        'QR_TABLE_SESSION_INVALID',
        'Bàn đang mở nhưng phiên gọi món chưa sẵn sàng.',
        409,
      );
    }
    if (input.rawGuest) {
      const existing = await this.repository.findGuestSession(
        await hashOpaqueToken(input.rawGuest, this.pepper),
        now,
      );
      if (existing?.timeSessionId === context.timeSessionId && existing.qrId === context.qrId) {
        await this.repository.touchGuestSession(existing.guestSessionId, now);
        return { rawGuest: input.rawGuest, context: await this.responseContext(existing) };
      }
    }

    const rawGuest = randomOpaqueToken(32);
    const expiresAt = now + 8 * 60 * 60_000;
    const guestSessionId = crypto.randomUUID();
    await this.repository.createGuestSession({
      id: guestSessionId,
      secretHash: await hashOpaqueToken(rawGuest, this.pepper),
      context,
      ipHash: input.ip ? await hashOpaqueToken(`guest-ip:${input.ip}`, this.pepper) : null,
      deviceNonce: input.deviceNonce,
      now,
      expiresAt,
    });
    return {
      rawGuest,
      context: await this.responseContext({
        ...context,
        guestSessionId,
        expiresAt,
        locationVerifiedAt: null,
        locationDistanceMeters: null,
        locationAccuracyMeters: null,
        locationExpiresAt: null,
      }),
    };
  }

  async requestTableOpen(
    rawQrToken: string,
    ip: string | null,
    location?: VerifyGuestLocationInput | null,
  ) {
    const context = await this.repository.findQrTableContext(
      await hashOpaqueToken(rawQrToken, this.pepper),
    );
    if (!context || context.tableStatus === 'DISABLED') {
      throw new AppError('QR_TABLE_NOT_ACTIVE', 'Mã QR không còn hiệu lực.', 409);
    }
    if (context.locationVerificationEnabled === 1) {
      if (!location) {
        throw new AppError(
          'LOCATION_VERIFICATION_REQUIRED',
          'Vui lòng xác minh vị trí tại quán để gửi yêu cầu mở bàn.',
          403,
          {
            required: true,
            configured: context.latitude !== null && context.longitude !== null,
            allowedRadiusMeters: context.allowedRadiusMeters,
            maxAccuracyMeters: context.maxAccuracyMeters,
          },
        );
      }
      verifyLocationCoordinates({
        storeSettings: {
          locationVerificationEnabled: true,
          latitude: context.latitude,
          longitude: context.longitude,
          allowedRadiusMeters: context.allowedRadiusMeters,
          maxAccuracyMeters: context.maxAccuracyMeters,
        },
        input: location,
        serverNow: Date.now(),
      });
    }
    if (context.tableStatus === 'OCCUPIED') {
      return {
        ...context,
        alreadyOpen: true,
        requestId: null,
        replayed: true,
        createdAt: null,
      };
    }
    const now = Date.now();
    await this.repository.expireTableOpenRequests(
      context.storeId,
      now - TABLE_OPEN_REQUEST_TTL_MS,
      now,
    );
    const existing = await this.repository.findOpenTableRequest(context.storeId, context.tableId);
    if (existing) {
      return {
        ...context,
        alreadyOpen: false,
        requestId: existing.id,
        replayed: true,
        createdAt: existing.createdAt,
      };
    }
    const id = crypto.randomUUID();
    try {
      await this.repository.createTableOpenRequest({
        id,
        context,
        ipHash: ip ? await hashOpaqueToken(`guest-ip:${ip}`, this.pepper) : null,
        now,
      });
    } catch (error) {
      const concurrent = await this.repository.findOpenTableRequest(
        context.storeId,
        context.tableId,
      );
      if (!concurrent) throw error;
      return {
        ...context,
        alreadyOpen: false,
        requestId: concurrent.id,
        replayed: true,
        createdAt: concurrent.createdAt,
      };
    }
    return {
      ...context,
      alreadyOpen: false,
      requestId: id,
      replayed: false,
      createdAt: now,
    };
  }

  async listTableOpenRequests(storeId: string) {
    const now = Date.now();
    await this.repository.expireTableOpenRequests(storeId, now - TABLE_OPEN_REQUEST_TTL_MS, now);
    return this.repository.listTableOpenRequests(storeId);
  }

  async acceptTableOpenRequest(input: {
    storeId: string;
    id: string;
    actorId: string;
    actorSessionId: string | null;
    deviceId: string | null;
    requestId: string;
    idempotencyKey: string;
  }) {
    const request = await this.repository.getTableOpenRequest(input.storeId, input.id);
    if (!request)
      throw new AppError('TABLE_OPEN_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu.', 404);
    if (request.status !== 'OPEN') {
      return { id: request.id, status: request.status, replayed: true };
    }
    if (request.tableStatus === 'DISABLED') {
      throw new AppError('TABLE_DISABLED', 'Bàn đang ngừng phục vụ.', 409);
    }
    let opened: { orderId?: string } | null = null;
    if (request.tableStatus === 'AVAILABLE') {
      opened = await new PosService(this.env).openTable({
        storeId: input.storeId,
        actorId: input.actorId,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        tableId: request.tableId,
        expectedTableVersion: request.tableVersion,
        actorSessionId: input.actorSessionId,
        deviceId: input.deviceId,
      });
    }
    await this.repository.completeTableOpenRequest({
      storeId: input.storeId,
      id: input.id,
      actorId: input.actorId,
      now: Date.now(),
    });
    return { id: input.id, status: 'COMPLETED' as const, orderId: opened?.orderId ?? null };
  }

  async cancelTableOpenRequest(input: {
    storeId: string;
    id: string;
    actorId: string;
    reason: string;
  }) {
    const request = await this.repository.getTableOpenRequest(input.storeId, input.id);
    if (!request)
      throw new AppError('TABLE_OPEN_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu.', 404);
    if (request.status !== 'OPEN')
      return { id: request.id, status: request.status, replayed: true };
    await this.repository.cancelTableOpenRequest({
      ...input,
      now: Date.now(),
    });
    return { id: input.id, status: 'CANCELLED' as const };
  }

  async getContext(rawGuest: string) {
    const session = await this.contextFromSession(rawGuest);
    await this.repository.touchGuestSession(session.guestSessionId, Date.now());
    return this.responseContext(session);
  }

  async getMedia(rawGuest: string, mediaId: string) {
    const session = await this.contextFromSession(rawGuest);
    return new MediaService(this.env).get(session.storeId, mediaId);
  }

  async getMediaByQr(rawQrToken: string, mediaId: string) {
    const context = await this.repository.findQrTableContext(
      await hashOpaqueToken(rawQrToken, this.pepper),
    );
    if (!context || context.tableStatus === 'DISABLED') {
      throw new AppError('QR_TABLE_NOT_ACTIVE', 'Mã QR không còn hiệu lực.', 409);
    }
    return new MediaService(this.env).get(context.storeId, mediaId);
  }

  async verifyLocation(
    rawGuest: string,
    input: VerifyGuestLocationInput,
  ): Promise<VerifyGuestLocationResponse> {
    const session = await this.contextFromSession(rawGuest);
    const now = Date.now();
    const result = verifyLocationCoordinates({
      storeSettings: {
        locationVerificationEnabled: session.locationVerificationEnabled === 1,
        latitude: session.latitude,
        longitude: session.longitude,
        allowedRadiusMeters: session.allowedRadiusMeters,
        maxAccuracyMeters: session.maxAccuracyMeters,
      },
      input,
      serverNow: now,
      sessionTtlMs: LOCATION_VERIFICATION_SESSION_TTL_MS,
    });
    await this.repository.updateGuestLocationVerification({
      guestSessionId: session.guestSessionId,
      verifiedAt: result.verifiedAt,
      distanceMeters: result.distanceMeters,
      accuracyMeters: result.accuracyMeters,
      expiresAt: result.expiresAt,
    });
    return {
      verified: true,
      distanceMeters: result.distanceMeters,
      allowedRadiusMeters: result.allowedRadiusMeters,
      expiresAt: result.expiresAt,
    };
  }

  async verifyLocationByToken(
    rawQrToken: string,
    input: VerifyGuestLocationInput,
    rawGuest?: string,
  ): Promise<VerifyGuestLocationResponse & { rawGuest?: string }> {
    const tokenHash = await hashOpaqueToken(rawQrToken, this.pepper);
    const tableContext = await this.repository.findQrTableContext(tokenHash);
    if (!tableContext || tableContext.tableStatus === 'DISABLED') {
      throw new AppError('QR_TABLE_NOT_ACTIVE', 'Mã QR đã bị thay đổi hoặc không hoạt động.', 409);
    }
    const now = Date.now();
    const result = verifyLocationCoordinates({
      storeSettings: {
        locationVerificationEnabled: tableContext.locationVerificationEnabled === 1,
        latitude: tableContext.latitude,
        longitude: tableContext.longitude,
        allowedRadiusMeters: tableContext.allowedRadiusMeters,
        maxAccuracyMeters: tableContext.maxAccuracyMeters,
      },
      input,
      serverNow: now,
      sessionTtlMs: LOCATION_VERIFICATION_SESSION_TTL_MS,
    });

    let returnRawGuest = rawGuest;
    if (rawGuest) {
      const existing = await this.repository.findGuestSession(
        await hashOpaqueToken(rawGuest, this.pepper),
        now,
      );
      if (existing) {
        await this.repository.updateGuestLocationVerification({
          guestSessionId: existing.guestSessionId,
          verifiedAt: result.verifiedAt,
          distanceMeters: result.distanceMeters,
          accuracyMeters: result.accuracyMeters,
          expiresAt: result.expiresAt,
        });
      }
    } else {
      const activeContext = await this.repository.findActiveQrContext(tokenHash);
      if (activeContext) {
        const newRawGuest = randomOpaqueToken(32);
        const guestSessionId = crypto.randomUUID();
        const sessionExpiresAt = now + 8 * 60 * 60_000;
        await this.repository.createGuestSession({
          id: guestSessionId,
          secretHash: await hashOpaqueToken(newRawGuest, this.pepper),
          context: activeContext,
          ipHash: null,
          deviceNonce: null,
          now,
          expiresAt: sessionExpiresAt,
        });
        await this.repository.updateGuestLocationVerification({
          guestSessionId,
          verifiedAt: result.verifiedAt,
          distanceMeters: result.distanceMeters,
          accuracyMeters: result.accuracyMeters,
          expiresAt: result.expiresAt,
        });
        returnRawGuest = newRawGuest;
      }
    }

    return {
      verified: true,
      distanceMeters: result.distanceMeters,
      allowedRadiusMeters: result.allowedRadiusMeters,
      expiresAt: result.expiresAt,
      ...(returnRawGuest ? { rawGuest: returnRawGuest } : {}),
    };
  }

  async submitOrder(
    rawGuest: string,
    input: SubmitGuestOrderInput,
    ip: string | null,
  ): Promise<SubmitOrderResult> {
    const session = await this.contextFromSession(rawGuest);
    if (input.location) {
      const now = Date.now();
      const result = verifyLocationCoordinates({
        storeSettings: {
          locationVerificationEnabled: session.locationVerificationEnabled === 1,
          latitude: session.latitude,
          longitude: session.longitude,
          allowedRadiusMeters: session.allowedRadiusMeters,
          maxAccuracyMeters: session.maxAccuracyMeters,
        },
        input: input.location,
        serverNow: now,
        sessionTtlMs: LOCATION_VERIFICATION_SESSION_TTL_MS,
      });
      await this.repository.updateGuestLocationVerification({
        guestSessionId: session.guestSessionId,
        verifiedAt: result.verifiedAt,
        distanceMeters: result.distanceMeters,
        accuracyMeters: result.accuracyMeters,
        expiresAt: result.expiresAt,
      });
      session.locationExpiresAt = result.expiresAt;
      session.locationDistanceMeters = result.distanceMeters;
      session.locationAccuracyMeters = result.accuracyMeters;
      session.locationVerifiedAt = result.verifiedAt;
    }
    this.assertLocationVerified(session);
    const replay = await this.repository.findRequestByClient(
      session.guestSessionId,
      input.clientRequestId,
    );
    if (replay) {
      return {
        requestId: replay.id,
        replayed: true,
        storeId: session.storeId,
        tableName: session.tableName,
      };
    }

    const items = await Promise.all(
      input.items.map(async (requested) => {
        const product = await this.repository.findSaleVariant(
          session.storeId,
          requested.productId,
          requested.variantId ?? null,
        );
        if (!product) {
          throw new AppError('PRODUCT_NOT_AVAILABLE', 'Một mặt hàng không còn khả dụng.', 422);
        }
        const quantityMilli = requested.quantity * 1000;
        return {
          id: crypto.randomUUID(),
          productId: product.productId,
          variantId: product.variantId,
          productName: product.productName,
          variantName: product.variantName,
          unitName: product.unitName,
          unitPriceVnd: product.salePriceVnd,
          quantityMilli,
          lineTotalVnd: product.salePriceVnd * requested.quantity,
          note: requested.note?.trim() || null,
        };
      }),
    );

    const requestId = crypto.randomUUID();
    const createdAt = Date.now();
    const notificationSummary = items
      .map((item) => {
        const variant =
          item.variantName && item.variantName !== 'Mặc định' ? ` · ${item.variantName}` : '';
        const itemNote = item.note ? ` (${item.note})` : '';
        return `${item.productName}${variant} ×${item.quantityMilli / 1000}${itemNote}`;
      })
      .join(', ')
      .slice(0, 800);
    try {
      await this.repository.createGuestOrder({
        commandId: crypto.randomUUID(),
        requestId,
        clientRequestId: input.clientRequestId,
        session,
        note: input.note?.trim() || null,
        ipHash: ip ? await hashOpaqueToken(`guest-ip:${ip}`, this.pepper) : null,
        now: createdAt,
        items,
        notificationSummary,
        notificationItemCount: items.reduce((sum, item) => sum + item.quantityMilli / 1000, 0),
        notificationTotalVnd: items.reduce((sum, item) => sum + item.lineTotalVnd, 0),
        notificationExpiresAt: createdAt + STAFF_NOTIFICATION_RETENTION_MS,
      });
    } catch (error) {
      const concurrentReplay = await this.repository.findRequestByClient(
        session.guestSessionId,
        input.clientRequestId,
      );
      if (concurrentReplay) {
        return {
          requestId: concurrentReplay.id,
          replayed: true,
          storeId: session.storeId,
          tableName: session.tableName,
        };
      }
      mapDatabaseError(error);
    }
    return {
      requestId,
      replayed: false,
      storeId: session.storeId,
      tableName: session.tableName,
      areaName: session.areaName,
      orderId: session.orderId,
      createdAt,
      note: input.note?.trim() || null,
      items: items.map((item) => ({
        productName: item.productName,
        variantName: item.variantName,
        quantity: item.quantityMilli / 1000,
        lineTotalVnd: item.lineTotalVnd,
        note: item.note,
      })),
    };
  }

  async listGuestRequests(rawGuest: string) {
    const session = await this.contextFromSession(rawGuest);
    return this.repository.listGuestRequestsBySession(session.guestSessionId);
  }

  async createServiceRequest(
    rawGuest: string,
    type: 'CALL_STAFF' | 'CHECKOUT_REQUEST',
    _ip?: string | null,
    location?: VerifyGuestLocationInput | null,
  ) {
    const session = await this.contextFromSession(rawGuest);
    if (location) {
      const now = Date.now();
      const result = verifyLocationCoordinates({
        storeSettings: {
          locationVerificationEnabled: session.locationVerificationEnabled === 1,
          latitude: session.latitude,
          longitude: session.longitude,
          allowedRadiusMeters: session.allowedRadiusMeters,
          maxAccuracyMeters: session.maxAccuracyMeters,
        },
        input: location,
        serverNow: now,
        sessionTtlMs: LOCATION_VERIFICATION_SESSION_TTL_MS,
      });
      await this.repository.updateGuestLocationVerification({
        guestSessionId: session.guestSessionId,
        verifiedAt: result.verifiedAt,
        distanceMeters: result.distanceMeters,
        accuracyMeters: result.accuracyMeters,
        expiresAt: result.expiresAt,
      });
      session.locationExpiresAt = result.expiresAt;
      session.locationDistanceMeters = result.distanceMeters;
      session.locationAccuracyMeters = result.accuracyMeters;
      session.locationVerifiedAt = result.verifiedAt;
    }
    this.assertLocationVerified(session);
    const now = Date.now();
    const existing = await this.repository.findOpenServiceRequest(
      session.timeSessionId,
      type,
      now - 60_000,
    );
    if (existing) {
      const elapsedSec = existing.createdAt ? Math.floor((now - existing.createdAt) / 1000) : 0;
      const remainingSec = Math.max(1, 60 - elapsedSec);
      throw new AppError(
        'REQUEST_COOLDOWN',
        `Yêu cầu đã được gửi. Vui lòng chờ ${remainingSec}s trước khi gửi lại.`,
        429,
        {
          requestId: existing.id,
          retryAfterSeconds: remainingSec,
        },
      );
    }
    const id = crypto.randomUUID();
    try {
      await this.repository.createServiceRequest({
        id,
        session,
        type,
        now,
        notificationExpiresAt: now + STAFF_NOTIFICATION_RETENTION_MS,
      });
    } catch (error) {
      mapDatabaseError(error);
    }
    return {
      id,
      status: 'OPEN' as const,
      storeId: session.storeId,
      tableName: session.tableName,
      areaName: session.areaName,
      orderId: session.orderId,
      createdAt: now,
    };
  }

  listStaffRequests(storeId: string, status?: string) {
    return this.repository.listStaffRequests(storeId, status);
  }

  listServiceRequests(storeId: string) {
    return this.repository.listServiceRequests(storeId);
  }

  async listNotificationAudit(storeId: string, limit: number) {
    const since = Date.now() - STAFF_NOTIFICATION_RETENTION_MS;
    const [notifications, operational] = await Promise.all([
      this.repository.listNotificationAudit(storeId, limit),
      this.repository.listOperationalAudit(storeId, since, limit),
    ]);
    return {
      retentionDays: STAFF_NOTIFICATION_RETENTION_DAYS,
      items: [...notifications, ...operational.map(mapOperationalAudit)]
        .toSorted((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit),
    };
  }

  async accept(input: {
    commandId: string;
    storeId: string;
    guestRequestId: string;
    expectedOrderVersion: number;
    actorId: string;
    actorSessionId: string | null;
    deviceId: string | null;
    requestId: string;
  }) {
    const replay = await this.repository.findAcceptCommand(input.storeId, input.commandId);
    if (replay) return { id: replay.guestRequestId, status: 'ACCEPTED' as const, replayed: true };
    try {
      await this.repository.acceptRequest({ ...input, now: Date.now() });
    } catch (error) {
      mapDatabaseError(error);
    }
    return { id: input.guestRequestId, status: 'ACCEPTED' as const, replayed: false };
  }

  async reject(input: {
    commandId: string;
    storeId: string;
    guestRequestId: string;
    reason: string;
    actorId: string;
    actorSessionId: string | null;
    deviceId: string | null;
    requestId: string;
  }) {
    const replay = await this.repository.findRejectCommand(input.storeId, input.commandId);
    if (replay) return { id: replay.guestRequestId, status: 'REJECTED' as const, replayed: true };
    try {
      await this.repository.rejectRequest({ ...input, now: Date.now() });
    } catch (error) {
      mapDatabaseError(error);
    }
    return { id: input.guestRequestId, status: 'REJECTED' as const, replayed: false };
  }

  async updateService(input: {
    storeId: string;
    id: string;
    action: 'ACKNOWLEDGE' | 'COMPLETE';
    actorId: string;
    actorSessionId?: string | null;
    deviceId?: string | null;
    requestId: string;
  }) {
    const result = await this.repository.updateServiceRequest({
      ...input,
      actorSessionId: input.actorSessionId ?? null,
      deviceId: input.deviceId ?? null,
      now: Date.now(),
    });
    if (!result) throw new AppError('SERVICE_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu.', 404);
    if (result.conflict) {
      throw new AppError('SERVICE_REQUEST_ALREADY_UPDATED', 'Yêu cầu đã được xử lý trước đó.', 409);
    }
    return result;
  }

  async getQrCode(storeId: string, tableId: string) {
    const current = await this.repository.findQrCode(storeId, tableId);
    return current
      ? {
          exists: true,
          path: current.publicToken ? `/q/${current.publicToken}` : null,
          version: current.version,
          enabled: current.enabled === 1,
          rotatedAt: current.rotatedAt,
        }
      : { exists: false, path: null, version: 0, enabled: false, rotatedAt: null };
  }

  async getOrCreateQrCode(storeId: string, tableId: string, actorId: string) {
    if (!(await this.repository.findTable(storeId, tableId))) {
      throw new AppError('TABLE_NOT_FOUND', 'Không tìm thấy bàn trong cửa hàng.', 404);
    }
    const existing = await this.repository.findQrCode(storeId, tableId);
    if (existing?.publicToken) {
      return {
        path: `/q/${existing.publicToken}`,
        version: existing.version,
        enabled: existing.enabled === 1,
      };
    }
    // No QR yet or legacy row without public_token — initialize once
    const rawToken = randomOpaqueToken(24);
    try {
      await this.repository.rotateQrCode({
        id: crypto.randomUUID(),
        storeId,
        tableId,
        tokenHash: await hashOpaqueToken(rawToken, this.pepper),
        publicToken: rawToken,
        actorId,
        now: Date.now(),
      });
    } catch (error) {
      if (String(error).includes('FOREIGN KEY')) {
        throw new AppError('TABLE_NOT_FOUND', 'Không tìm thấy bàn trong cửa hàng.', 404);
      }
      throw error;
    }
    const created = await this.repository.findQrCode(storeId, tableId);
    return {
      path: `/q/${rawToken}`,
      version: created?.version ?? 1,
      enabled: created ? created.enabled === 1 : true,
    };
  }

  async rotateQrCode(storeId: string, tableId: string, actorId: string) {
    if (!(await this.repository.findTable(storeId, tableId))) {
      throw new AppError('TABLE_NOT_FOUND', 'Không tìm thấy bàn trong cửa hàng.', 404);
    }
    const rawToken = randomOpaqueToken(24);
    const now = Date.now();
    try {
      await this.repository.rotateQrCode({
        id: crypto.randomUUID(),
        storeId,
        tableId,
        tokenHash: await hashOpaqueToken(rawToken, this.pepper),
        publicToken: rawToken,
        actorId,
        now,
      });
    } catch (error) {
      if (String(error).includes('FOREIGN KEY')) {
        throw new AppError('TABLE_NOT_FOUND', 'Không tìm thấy bàn trong cửa hàng.', 404);
      }
      throw error;
    }
    // Security: revoke all active guest sessions for this table
    await this.repository.revokeGuestSessionsByTable(storeId, tableId);
    return { token: rawToken, path: `/q/${rawToken}` };
  }
}
