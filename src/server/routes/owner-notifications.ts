import { Hono } from 'hono';

import {
  bulkUpdateStaffNotificationSchema,
  testPushNotificationSchema,
  updateStaffNotificationSchema,
  type StoreNotificationOverviewDto,
} from '@contracts/staff-notifications';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { StaffNotificationRepository } from '@server/repositories/staff-notification-repository';
import { PushNotificationService } from '@server/services/push-notification-service';
import type { AppEnv } from '@server/types';

const ownerNotificationRoutes = new Hono<AppEnv>();

ownerNotificationRoutes.use('*', requireActor('OWNER'));
ownerNotificationRoutes.use('*', requirePermission('staff.manage'));

ownerNotificationRoutes.get('/settings', async (c) => {
  const storeId = c.get('actor').storeId!;
  const repo = new StaffNotificationRepository(c.env.DB);
  const pushService = new PushNotificationService(c.env);
  const now = Date.now();

  const [items, totalSubscriptions] = await Promise.all([
    repo.listStoreNotificationSettings(storeId, now),
    repo.countSubscriptions(storeId),
  ]);

  const overview: StoreNotificationOverviewDto = {
    vapidConfigured: pushService.isConfigured(),
    totalStaff: items.length,
    enabledStaffCount: items.filter((item) => item.enabled).length,
    totalSubscriptions,
    items,
  };

  return success(c, overview);
});

ownerNotificationRoutes.put('/settings/:userId', async (c) => {
  const storeId = c.get('actor').storeId!;
  const userId = c.req.param('userId');
  const body = await parseJson(c.req.raw, updateStaffNotificationSchema);
  const repo = new StaffNotificationRepository(c.env.DB);

  await repo.upsert({
    storeId,
    userId,
    settings: body,
    now: Date.now(),
  });

  return success(c, { updated: true });
});

ownerNotificationRoutes.post('/settings/bulk', async (c) => {
  const storeId = c.get('actor').storeId!;
  const body = await parseJson(c.req.raw, bulkUpdateStaffNotificationSchema);
  const repo = new StaffNotificationRepository(c.env.DB);

  await repo.bulkUpsert({
    storeId,
    userIds: body.userIds,
    settings: body.settings,
    now: Date.now(),
  });

  return success(c, { updatedCount: body.userIds.length });
});

ownerNotificationRoutes.post('/test', async (c) => {
  const storeId = c.get('actor').storeId!;
  const body = await parseJson(c.req.raw, testPushNotificationSchema);
  const pushService = new PushNotificationService(c.env);

  const testConfig: Record<
    typeof body.kind,
    {
      title: string;
      body: string;
      soundType?:
        | 'PAYMENT_SUCCESS'
        | 'NEW_QR_ORDER'
        | 'CALL_STAFF'
        | 'CHECKOUT_REQUEST'
        | 'TABLE_OPEN_REQUEST'
        | 'NOTIFICATION_CHIME';
    }
  > = {
    ORDER_PAID: {
      title: '💳 Thanh toán thành công (Thử nghiệm)',
      body: 'Bàn 01 • 150.000đ • Chuyển khoản • HĐ: #TEST-01',
      soundType: 'PAYMENT_SUCCESS',
    },
    QR_ORDER: {
      title: '🍽️ Bàn 02: 3 món mới (Thử nghiệm)',
      body: 'Khu A • Cà phê sữa ×2, Bạc xỉu ×1 • Tổng 105.000đ',
      soundType: 'NEW_QR_ORDER',
    },
    CALL_STAFF: {
      title: '🔔 Bàn 03 gọi nhân viên (Thử nghiệm)',
      body: 'Khu B • Khách đang gọi phục vụ tại bàn',
      soundType: 'CALL_STAFF',
    },
    CHECKOUT_REQUEST: {
      title: '💳 Bàn 04 yêu cầu thanh toán (Thử nghiệm)',
      body: 'Khu VIP • Khách yêu cầu thanh toán hóa đơn',
      soundType: 'CHECKOUT_REQUEST',
    },
    TABLE_OPEN_REQUEST: {
      title: '🪑 Bàn 05 yêu cầu mở bàn (Thử nghiệm)',
      body: 'Khu Sân Vườn • Khách quét mã QR và yêu cầu mở bàn',
      soundType: 'TABLE_OPEN_REQUEST',
    },
    PRINT_COMPLETED: {
      title: '🖨️ In hoàn tất (Thử nghiệm)',
      body: 'Máy in Quầy Thu Ngân • Đã in thành công hóa đơn #TEST-01',
      soundType: 'NOTIFICATION_CHIME',
    },
  };

  const payload = testConfig[body.kind];

  const result = await pushService.sendStoreNotification({
    storeId,
    kind: body.kind,
    ...(payload.soundType ? { soundType: payload.soundType } : {}),
    title: payload.title,
    body: payload.body,
    url: '/owner/settings/notifications',
    tag: body.tag ?? `test-notification:${Date.now()}`,
    timestamp: Date.now(),
    actionTitle: 'Xem thông báo',
    targetUserId: body.userId ?? null,
  });

  return success(c, result);
});

export { ownerNotificationRoutes };
