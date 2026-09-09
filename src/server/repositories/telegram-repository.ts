import type {
  TelegramAdminLinkRecord,
  TelegramAuthorizedAdmin,
} from '../integrations/telegram/telegram-types';

export class TelegramRepository {
  constructor(private readonly db: D1Database) {}

  async findAuthorizedAdmin(telegramUserId: string): Promise<TelegramAuthorizedAdmin | null> {
    const row = await this.db
      .prepare(
        `SELECT
           tal.id as link_id,
           tal.user_id as link_user_id,
           tal.telegram_user_id,
           tal.telegram_username,
           tal.telegram_first_name,
           tal.telegram_last_name,
           tal.telegram_chat_id,
           tal.linked_at,
           tal.updated_at,
           u.id as user_id,
           u.display_name as user_display_name,
           u.username as user_username,
           u.email as user_email,
           u.status as user_status,
           u.platform_role as user_platform_role
         FROM telegram_admin_links tal
         JOIN users u ON u.id = tal.user_id
         WHERE tal.telegram_user_id = ?`,
      )
      .bind(telegramUserId)
      .first<{
        link_id: string;
        link_user_id: string;
        telegram_user_id: string;
        telegram_username: string | null;
        telegram_first_name: string | null;
        telegram_last_name: string | null;
        telegram_chat_id: string | null;
        linked_at: number;
        updated_at: number;
        user_id: string;
        user_display_name: string;
        user_username: string;
        user_email: string | null;
        user_status: 'ACTIVE' | 'DISABLED';
        user_platform_role: 'SUPER_ADMIN' | null;
      }>();

    if (!row) return null;

    return {
      link: {
        id: row.link_id,
        userId: row.link_user_id,
        telegramUserId: row.telegram_user_id,
        telegramUsername: row.telegram_username,
        telegramFirstName: row.telegram_first_name,
        telegramLastName: row.telegram_last_name,
        telegramChatId: row.telegram_chat_id,
        linkedAt: row.linked_at,
        updatedAt: row.updated_at,
      },
      user: {
        id: row.user_id,
        displayName: row.user_display_name,
        username: row.user_username,
        email: row.user_email,
        status: row.user_status,
        platformRole: row.user_platform_role,
      },
    };
  }

  async getLinkByUserId(userId: string): Promise<TelegramAdminLinkRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT id, user_id, telegram_user_id, telegram_username, telegram_first_name,
                telegram_last_name, telegram_chat_id, linked_at, updated_at
         FROM telegram_admin_links
         WHERE user_id = ?`,
      )
      .bind(userId)
      .first<{
        id: string;
        user_id: string;
        telegram_user_id: string;
        telegram_username: string | null;
        telegram_first_name: string | null;
        telegram_last_name: string | null;
        telegram_chat_id: string | null;
        linked_at: number;
        updated_at: number;
      }>();

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      telegramUserId: row.telegram_user_id,
      telegramUsername: row.telegram_username,
      telegramFirstName: row.telegram_first_name,
      telegramLastName: row.telegram_last_name,
      telegramChatId: row.telegram_chat_id,
      linkedAt: row.linked_at,
      updatedAt: row.updated_at,
    };
  }

  async upsertLink(input: {
    id: string;
    userId: string;
    telegramUserId: string;
    telegramUsername?: string | null;
    telegramFirstName?: string | null;
    telegramLastName?: string | null;
    telegramChatId?: string | null;
    now: number;
  }): Promise<void> {
    // Delete any existing link for this user to maintain 1:1, or replace if telegram_user_id conflicts
    await this.db
      .prepare(
        `INSERT INTO telegram_admin_links (
           id, user_id, telegram_user_id, telegram_username,
           telegram_first_name, telegram_last_name, telegram_chat_id,
           linked_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (telegram_user_id) DO UPDATE SET
           user_id = excluded.user_id,
           telegram_username = excluded.telegram_username,
           telegram_first_name = excluded.telegram_first_name,
           telegram_last_name = excluded.telegram_last_name,
           telegram_chat_id = excluded.telegram_chat_id,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.id,
        input.userId,
        input.telegramUserId,
        input.telegramUsername ?? null,
        input.telegramFirstName ?? null,
        input.telegramLastName ?? null,
        input.telegramChatId ?? null,
        input.now,
        input.now,
      )
      .run();
  }

  async deleteLinkByUserId(userId: string): Promise<number> {
    const result = await this.db
      .prepare(`DELETE FROM telegram_admin_links WHERE user_id = ?`)
      .bind(userId)
      .run();
    return result.meta.changes ?? 0;
  }

  async createLinkCode(input: {
    id: string;
    userId: string;
    codeHash: string;
    expiresAt: number;
    now: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO telegram_link_codes (id, user_id, code_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .bind(input.id, input.userId, input.codeHash, input.expiresAt, input.now)
      .run();
  }

  async findValidLinkCode(
    codeHash: string,
    now: number,
  ): Promise<{
    codeId: string;
    userId: string;
    userStatus: 'ACTIVE' | 'DISABLED';
    platformRole: 'SUPER_ADMIN' | null;
    displayName: string;
  } | null> {
    const row = await this.db
      .prepare(
        `SELECT
           c.id as code_id,
           c.user_id,
           u.status as user_status,
           u.platform_role,
           u.display_name
         FROM telegram_link_codes c
         JOIN users u ON u.id = c.user_id
         WHERE c.code_hash = ?
           AND c.used_at IS NULL
           AND c.expires_at > ?`,
      )
      .bind(codeHash, now)
      .first<{
        code_id: string;
        user_id: string;
        user_status: 'ACTIVE' | 'DISABLED';
        platform_role: 'SUPER_ADMIN' | null;
        display_name: string;
      }>();

    if (!row) return null;

    return {
      codeId: row.code_id,
      userId: row.user_id,
      userStatus: row.user_status,
      platformRole: row.platform_role,
      displayName: row.display_name,
    };
  }

  async consumeLinkCode(codeId: string, now: number): Promise<boolean> {
    const result = await this.db
      .prepare(`UPDATE telegram_link_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`)
      .bind(now, codeId)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async getSystemMetrics(): Promise<{
    activeStoresCount: number;
    lockedStoresCount: number;
    realtimePendingCount: number;
    abnormalPrintJobsCount: number;
  }> {
    const [storesRow, realtimeRow, printJobsRow] = await Promise.all([
      this.db
        .prepare(
          `SELECT
             COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_count,
             COUNT(CASE WHEN status = 'LOCKED' THEN 1 END) as locked_count
           FROM stores`,
        )
        .first<{ active_count: number; locked_count: number }>(),

      this.db
        .prepare(
          `SELECT COUNT(*) as pending_count
           FROM realtime_events_v2
           WHERE published_at IS NULL`,
        )
        .first<{ pending_count: number }>()
        .catch(() => ({ pending_count: 0 })),

      this.db
        .prepare(
          `SELECT COUNT(*) as abnormal_count
           FROM print_jobs
           WHERE status IN ('FAILED', 'UNCERTAIN')`,
        )
        .first<{ abnormal_count: number }>()
        .catch(() => ({ abnormal_count: 0 })),
    ]);

    return {
      activeStoresCount: storesRow?.active_count ?? 0,
      lockedStoresCount: storesRow?.locked_count ?? 0,
      realtimePendingCount: realtimeRow?.pending_count ?? 0,
      abnormalPrintJobsCount: printJobsRow?.abnormal_count ?? 0,
    };
  }
}
