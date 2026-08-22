import type { SubmitGuestOrderInput } from './qr-order-types';
import type { GuestOrderContext } from '@contracts/qr-order';
import { AppError } from '@server/lib/app-error';
import { hashOpaqueToken, randomOpaqueToken } from '@server/lib/crypto';
import { requireSecret } from '@server/lib/env';
import { QrOrderRepository, type GuestSessionRow } from '@server/repositories/qr-order-repository';
import { MediaService } from '@server/services/media-service';

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

  private async responseContext(session: GuestSessionRow): Promise<GuestOrderContext> {
    return {
      storeName: session.storeName,
      tableName: session.tableName,
      areaName: session.areaName,
      table: {
        id: session.tableId,
        name: session.tableName,
        areaName: session.areaName,
      },
      sessionExpiresAt: session.expiresAt,
      menu: await this.repository.listMenu(session.storeId),
    };
  }

  async resolveQr(input: {
    rawQrToken: string;
    rawGuest?: string;
    ip: string | null;
    deviceNonce: string | null;
  }) {
    const now = Date.now();
    const context = await this.repository.findActiveQrContext(
      await hashOpaqueToken(input.rawQrToken, this.pepper),
    );
    if (!context) {
      throw new AppError(
        'QR_TABLE_NOT_ACTIVE',
        'Bàn chưa mở, mã QR đã bị thay đổi hoặc hiện không nhận gọi món.',
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
      context: await this.responseContext({ ...context, guestSessionId, expiresAt }),
    };
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

  async submitOrder(
    rawGuest: string,
    input: SubmitGuestOrderInput,
    ip: string | null,
  ): Promise<SubmitOrderResult> {
    const session = await this.contextFromSession(rawGuest);
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

  async createServiceRequest(rawGuest: string, type: 'CALL_STAFF' | 'CHECKOUT_REQUEST') {
    const session = await this.contextFromSession(rawGuest);
    const existing = await this.repository.findOpenServiceRequest(
      session.timeSessionId,
      type,
      Date.now() - 30_000,
    );
    if (existing) {
      throw new AppError('REQUEST_ALREADY_OPEN', 'Yêu cầu này đang chờ nhân viên xử lý.', 409, {
        requestId: existing.id,
      });
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await this.repository.createServiceRequest({ id, session, type, now });
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
    requestId: string;
  }) {
    const result = await this.repository.updateServiceRequest({ ...input, now: Date.now() });
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
          version: current.version,
          enabled: current.enabled === 1,
          rotatedAt: current.rotatedAt,
        }
      : { exists: false, version: 0, enabled: false, rotatedAt: null };
  }

  async rotateQrCode(storeId: string, tableId: string, actorId: string) {
    if (!(await this.repository.findTable(storeId, tableId))) {
      throw new AppError('TABLE_NOT_FOUND', 'Không tìm thấy bàn trong cửa hàng.', 404);
    }
    const rawToken = randomOpaqueToken(24);
    try {
      await this.repository.rotateQrCode({
        id: crypto.randomUUID(),
        storeId,
        tableId,
        tokenHash: await hashOpaqueToken(rawToken, this.pepper),
        actorId,
        now: Date.now(),
      });
    } catch (error) {
      if (String(error).includes('FOREIGN KEY')) {
        throw new AppError('TABLE_NOT_FOUND', 'Không tìm thấy bàn trong cửa hàng.', 404);
      }
      throw error;
    }
    return { token: rawToken, path: `/q/${rawToken}` };
  }
}
