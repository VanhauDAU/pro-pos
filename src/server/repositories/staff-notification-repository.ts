import type {
  StaffNotificationItemDto,
  UpdateStaffNotificationInput,
} from '@contracts/staff-notifications';

interface RawStaffNotificationRow {
  userId: string;
  username: string;
  displayName: string;
  roleName: string;
  roleCode: string;
  status: 'ACTIVE' | 'DISABLED';
  enabled: number;
  onlyActiveSessions: number;
  notifyOrderPaid: number;
  notifyQrOrder: number;
  notifyCallStaff: number;
  notifyCheckoutRequest: number;
  notifyTableOpenRequest: number;
  notifyPrintStatus: number;
  updatedAt: number | null;
  subscriptionCount: number;
  activeSessionsCount: number;
}

export class StaffNotificationRepository {
  constructor(private readonly db: D1Database) {}

  async listStoreNotificationSettings(
    storeId: string,
    now: number,
  ): Promise<StaffNotificationItemDto[]> {
    const query = `
      SELECT
        u.id AS userId,
        u.username,
        u.display_name AS displayName,
        CASE WHEN u.status = 'ACTIVE' AND sm.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'DISABLED' END AS status,
        r.code AS roleCode,
        r.name AS roleName,
        COALESCE(sns.enabled, 1) AS enabled,
        COALESCE(sns.only_active_sessions, 1) AS onlyActiveSessions,
        COALESCE(sns.notify_order_paid, 1) AS notifyOrderPaid,
        COALESCE(sns.notify_qr_order, 1) AS notifyQrOrder,
        COALESCE(sns.notify_call_staff, 1) AS notifyCallStaff,
        COALESCE(sns.notify_checkout_request, 1) AS notifyCheckoutRequest,
        COALESCE(sns.notify_table_open_request, 1) AS notifyTableOpenRequest,
        COALESCE(sns.notify_print_status, 1) AS notifyPrintStatus,
        sns.updated_at AS updatedAt,
        COUNT(DISTINCT ps.id) AS subscriptionCount,
        COUNT(DISTINCT s.id) AS activeSessionsCount
      FROM store_memberships sm
      JOIN users u ON u.id = sm.user_id
      JOIN roles r ON r.id = sm.role_id AND r.store_id = sm.store_id
      LEFT JOIN staff_notification_settings sns ON sns.store_id = sm.store_id AND sns.user_id = u.id
      LEFT JOIN push_subscriptions ps ON ps.store_id = sm.store_id AND ps.user_id = u.id
      LEFT JOIN auth_sessions s ON s.store_id = sm.store_id AND s.user_id = u.id
        AND s.status = 'ACTIVE' AND s.expires_at > ? AND s.idle_expires_at > ?
      WHERE sm.store_id = ? AND sm.deleted_at IS NULL
      GROUP BY u.id, r.code, r.name, sns.enabled, sns.only_active_sessions,
        sns.notify_order_paid, sns.notify_qr_order, sns.notify_call_staff,
        sns.notify_checkout_request, sns.notify_table_open_request, sns.notify_print_status, sns.updated_at
      ORDER BY
        CASE WHEN r.code = 'OWNER' THEN 0 ELSE 1 END,
        u.display_name COLLATE NOCASE
    `;

    const result = await this.db
      .prepare(query)
      .bind(now, now, storeId)
      .all<RawStaffNotificationRow>();

    return (result.results ?? []).map((row) => ({
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      roleName: row.roleName,
      roleCode: row.roleCode,
      status: row.status,
      hasPushSubscription: row.subscriptionCount > 0,
      activeSessionsCount: row.activeSessionsCount,
      enabled: Boolean(row.enabled),
      onlyActiveSessions: Boolean(row.onlyActiveSessions),
      notifyOrderPaid: Boolean(row.notifyOrderPaid),
      notifyQrOrder: Boolean(row.notifyQrOrder),
      notifyCallStaff: Boolean(row.notifyCallStaff),
      notifyCheckoutRequest: Boolean(row.notifyCheckoutRequest),
      notifyTableOpenRequest: Boolean(row.notifyTableOpenRequest),
      notifyPrintStatus: Boolean(row.notifyPrintStatus),
      updatedAt: row.updatedAt,
    }));
  }

  async getStaffNotificationSetting(storeId: string, userId: string) {
    return this.db
      .prepare(
        `SELECT
          store_id, user_id, enabled, only_active_sessions,
          notify_order_paid, notify_qr_order, notify_call_staff,
          notify_checkout_request, notify_table_open_request, notify_print_status,
          updated_at
        FROM staff_notification_settings
        WHERE store_id = ? AND user_id = ?`,
      )
      .bind(storeId, userId)
      .first<{
        store_id: string;
        user_id: string;
        enabled: number;
        only_active_sessions: number;
        notify_order_paid: number;
        notify_qr_order: number;
        notify_call_staff: number;
        notify_checkout_request: number;
        notify_table_open_request: number;
        notify_print_status: number;
        updated_at: number;
      }>();
  }

  async upsert(input: {
    storeId: string;
    userId: string;
    settings: UpdateStaffNotificationInput;
    now: number;
  }) {
    const existing = await this.getStaffNotificationSetting(input.storeId, input.userId);
    const enabled = input.settings.enabled ?? (existing ? Boolean(existing.enabled) : true);
    const onlyActiveSessions =
      input.settings.onlyActiveSessions ??
      (existing ? Boolean(existing.only_active_sessions) : true);
    const notifyOrderPaid =
      input.settings.notifyOrderPaid ?? (existing ? Boolean(existing.notify_order_paid) : true);
    const notifyQrOrder =
      input.settings.notifyQrOrder ?? (existing ? Boolean(existing.notify_qr_order) : true);
    const notifyCallStaff =
      input.settings.notifyCallStaff ?? (existing ? Boolean(existing.notify_call_staff) : true);
    const notifyCheckoutRequest =
      input.settings.notifyCheckoutRequest ??
      (existing ? Boolean(existing.notify_checkout_request) : true);
    const notifyTableOpenRequest =
      input.settings.notifyTableOpenRequest ??
      (existing ? Boolean(existing.notify_table_open_request) : true);
    const notifyPrintStatus =
      input.settings.notifyPrintStatus ?? (existing ? Boolean(existing.notify_print_status) : true);

    await this.db
      .prepare(
        `INSERT INTO staff_notification_settings (
          store_id, user_id, enabled, only_active_sessions,
          notify_order_paid, notify_qr_order, notify_call_staff,
          notify_checkout_request, notify_table_open_request, notify_print_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(store_id, user_id) DO UPDATE SET
          enabled = excluded.enabled,
          only_active_sessions = excluded.only_active_sessions,
          notify_order_paid = excluded.notify_order_paid,
          notify_qr_order = excluded.notify_qr_order,
          notify_call_staff = excluded.notify_call_staff,
          notify_checkout_request = excluded.notify_checkout_request,
          notify_table_open_request = excluded.notify_table_open_request,
          notify_print_status = excluded.notify_print_status,
          updated_at = excluded.updated_at`,
      )
      .bind(
        input.storeId,
        input.userId,
        enabled ? 1 : 0,
        onlyActiveSessions ? 1 : 0,
        notifyOrderPaid ? 1 : 0,
        notifyQrOrder ? 1 : 0,
        notifyCallStaff ? 1 : 0,
        notifyCheckoutRequest ? 1 : 0,
        notifyTableOpenRequest ? 1 : 0,
        notifyPrintStatus ? 1 : 0,
        input.now,
        input.now,
      )
      .run();
  }

  async bulkUpsert(input: {
    storeId: string;
    userIds: string[];
    settings: UpdateStaffNotificationInput;
    now: number;
  }) {
    for (const userId of input.userIds) {
      await this.upsert({
        storeId: input.storeId,
        userId,
        settings: input.settings,
        now: input.now,
      });
    }
  }

  async countSubscriptions(storeId: string): Promise<number> {
    const res = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM push_subscriptions WHERE store_id = ?`)
      .bind(storeId)
      .first<{ total: number }>();
    return res?.total ?? 0;
  }
}
