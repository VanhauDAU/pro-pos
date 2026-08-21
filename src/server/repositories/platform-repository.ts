export class PlatformRepository {
  constructor(private readonly db: D1Database) {}

  async hasSuperAdmin() {
    const row = await this.db
      .prepare("SELECT 1 AS found FROM users WHERE platform_role = 'SUPER_ADMIN' LIMIT 1")
      .first<{ found: 1 }>();
    return row?.found === 1;
  }

  async createSuperAdmin(input: {
    id: string;
    username?: string | undefined;
    email: string;
    displayName: string;
    password?:
      | {
          salt: string;
          digest: string;
          workFactor: number;
          pepperVersion: number;
        }
      | undefined;
    now: number;
  }) {
    const statements = [
      this.db
        .prepare(
          `INSERT INTO users (
            id, platform_role, username, email, display_name, status, created_at, updated_at
          ) VALUES (?, 'SUPER_ADMIN', ?, ?, ?, 'ACTIVE', ?, ?)`,
        )
        .bind(
          input.id,
          input.username || input.email,
          input.email,
          input.displayName,
          input.now,
          input.now,
        ),
      this.db
        .prepare(
          `INSERT INTO access_identities (
            user_id, provider, email, credential_version, created_at, updated_at
          ) VALUES (?, 'CLOUDFLARE_ACCESS', ?, 1, ?, ?)`,
        )
        .bind(input.id, input.email, input.now, input.now),
    ];

    if (input.password) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO password_credentials (
              user_id, algorithm, work_factor, salt, digest, pepper_version, credential_version, updated_at
            ) VALUES (?, 'PBKDF2-HMAC-SHA256', ?, ?, ?, ?, 1, ?)`,
          )
          .bind(
            input.id,
            input.password.workFactor,
            input.password.salt,
            input.password.digest,
            input.password.pepperVersion,
            input.now,
          ),
      );
    }

    await this.db.batch(statements);
  }

  async createStoreWithOwner(input: {
    storeId: string;
    storeName: string;
    ownerRoleId: string;
    employeeRoleId: string;
    ownerUserId: string;
    ownerMembershipId: string;
    ownerDisplayName: string;
    ownerEmail: string;
    ownerUsername?: string | undefined;
    ownerPassword?:
      | {
          salt: string;
          digest: string;
          workFactor: number;
          pepperVersion: number;
        }
      | undefined;
    now: number;
  }) {
    const employeePermissions = [
      'table.view',
      'table.open',
      'order.manage',
      'order.create',
      'checkout.complete',
      'invoice.view',
      'invoice.print',
    ];
    const statements = [
      this.db
        .prepare(
          `INSERT INTO stores (id, name, status, timezone, created_at, updated_at)
           VALUES (?, ?, 'ACTIVE', 'Asia/Ho_Chi_Minh', ?, ?)`,
        )
        .bind(input.storeId, input.storeName, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO store_settings (store_id, currency, business_day_cutoff_minutes, updated_at)
           VALUES (?, 'VND', 0, ?)`,
        )
        .bind(input.storeId, input.now),
      this.db
        .prepare(
          `INSERT INTO roles (id, store_id, code, name, is_system, created_at, updated_at)
           VALUES (?, ?, 'OWNER', 'Chủ cửa hàng', 1, ?, ?)`,
        )
        .bind(input.ownerRoleId, input.storeId, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO roles (id, store_id, code, name, is_system, created_at, updated_at)
           VALUES (?, ?, 'EMPLOYEE', 'Nhân viên', 1, ?, ?)`,
        )
        .bind(input.employeeRoleId, input.storeId, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO role_permissions (store_id, role_id, permission_key, created_at)
           SELECT ?, ?, key, ? FROM permissions`,
        )
        .bind(input.storeId, input.ownerRoleId, input.now),
      ...employeePermissions.map((permission) =>
        this.db
          .prepare(
            `INSERT INTO role_permissions (store_id, role_id, permission_key, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(input.storeId, input.employeeRoleId, permission, input.now),
      ),
      this.db
        .prepare(
          `INSERT INTO users (
            id, username, email, display_name, status, must_change_password, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'ACTIVE', 0, ?, ?)`,
        )
        .bind(
          input.ownerUserId,
          input.ownerUsername || input.ownerEmail,
          input.ownerEmail,
          input.ownerDisplayName,
          input.now,
          input.now,
        ),
      this.db
        .prepare(
          `INSERT INTO access_identities (
            user_id, provider, email, credential_version, created_at, updated_at
          ) VALUES (?, 'CLOUDFLARE_ACCESS', ?, 1, ?, ?)`,
        )
        .bind(input.ownerUserId, input.ownerEmail, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO store_memberships (
            id, store_id, user_id, role_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        )
        .bind(
          input.ownerMembershipId,
          input.storeId,
          input.ownerUserId,
          input.ownerRoleId,
          input.now,
          input.now,
        ),
    ];

    if (input.ownerPassword) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO password_credentials (
              user_id, algorithm, work_factor, salt, digest, pepper_version, credential_version, updated_at
            ) VALUES (?, 'PBKDF2-HMAC-SHA256', ?, ?, ?, ?, 1, ?)`,
          )
          .bind(
            input.ownerUserId,
            input.ownerPassword.workFactor,
            input.ownerPassword.salt,
            input.ownerPassword.digest,
            input.ownerPassword.pepperVersion,
            input.now,
          ),
      );
    }

    await this.db.batch(statements);
  }

  async listStores() {
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.status, s.timezone,
                s.created_at AS createdAt, s.updated_at AS updatedAt,
                EXISTS (
                  SELECT 1 FROM store_capabilities sc
                  WHERE sc.store_id = s.id AND sc.capability = 'POS_REALTIME' AND sc.enabled = 1
                ) AS posRealtimeEnabled
         FROM stores s ORDER BY s.created_at DESC`,
      )
      .all();
  }

  async setStoreCapability(input: {
    storeId: string;
    capability: 'POS_REALTIME';
    enabled: boolean;
    actorId: string;
    requestId: string;
    now: number;
  }) {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO store_capabilities (store_id, capability, enabled, updated_by, updated_at)
           SELECT id, ?, ?, ?, ? FROM stores WHERE id = ?
           ON CONFLICT(store_id, capability) DO UPDATE SET
             enabled = excluded.enabled,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
        )
        .bind(input.capability, input.enabled ? 1 : 0, input.actorId, input.now, input.storeId),
      this.db
        .prepare(
          `INSERT INTO audit_logs (
            id, store_id, actor_user_id, action, entity_type, entity_id,
            request_id, after_json, created_at
          ) SELECT ?, id, ?, 'STORE_CAPABILITY_UPDATED', 'STORE', id, ?, ?, ?
            FROM stores WHERE id = ?`,
        )
        .bind(
          crypto.randomUUID(),
          input.actorId,
          input.requestId,
          JSON.stringify({ capability: input.capability, enabled: input.enabled }),
          input.now,
          input.storeId,
        ),
    ]);
    return this.db
      .prepare(
        `SELECT enabled FROM store_capabilities
         WHERE store_id = ? AND capability = ? LIMIT 1`,
      )
      .bind(input.storeId, input.capability)
      .first<{ enabled: 0 | 1 }>();
  }

  async setStoreStatus(storeId: string, status: 'ACTIVE' | 'LOCKED', now: number) {
    return this.db
      .prepare('UPDATE stores SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, storeId)
      .run();
  }

  async getStoreDetails(storeId: string) {
    const store = await this.db
      .prepare(
        `SELECT
           s.id, s.name, s.status, s.timezone, s.created_at AS createdAt, s.updated_at AS updatedAt,
           EXISTS (
             SELECT 1 FROM store_capabilities sc
             WHERE sc.store_id = s.id AND sc.capability = 'POS_REALTIME' AND sc.enabled = 1
           ) AS posRealtimeEnabled,
           ss.currency, ss.business_day_cutoff_minutes AS businessDayCutoffMinutes,
           ss.phone, ss.address, ss.province_code AS provinceCode, ss.province_name AS provinceName,
           ss.ward_code AS wardCode, ss.ward_name AS wardName,
           ss.bank_name AS bankName, ss.bank_account_number AS bankAccountNumber,
           ss.bank_account_name AS bankAccountName, ss.bank_qr_media_id AS bankQrMediaId
         FROM stores s
         LEFT JOIN store_settings ss ON ss.store_id = s.id
         WHERE s.id = ?
         LIMIT 1`,
      )
      .bind(storeId)
      .first<{
        id: string;
        name: string;
        status: 'ACTIVE' | 'LOCKED';
        timezone: string;
        createdAt: number;
        updatedAt: number;
        posRealtimeEnabled: number;
        currency: string | null;
        businessDayCutoffMinutes: number | null;
        phone: string | null;
        address: string | null;
        provinceCode: number | null;
        provinceName: string | null;
        wardCode: number | null;
        wardName: string | null;
        bankName: string | null;
        bankAccountNumber: string | null;
        bankAccountName: string | null;
        bankQrMediaId: string | null;
      }>();

    if (!store) return null;

    const [members, devices, sessions, stats] = await Promise.all([
      this.db
        .prepare(
          `SELECT
             sm.id, sm.user_id AS userId, u.username, u.display_name AS displayName,
             u.email, u.phone, u.status AS userStatus, sm.status AS membershipStatus,
             r.code AS roleCode, r.name AS roleName, r.is_system AS isSystemRole,
             sm.created_at AS createdAt
           FROM store_memberships sm
           JOIN users u ON u.id = sm.user_id
           JOIN roles r ON r.id = sm.role_id
           WHERE sm.store_id = ?
           ORDER BY (CASE WHEN r.code = 'OWNER' THEN 0 ELSE 1 END), sm.created_at ASC`,
        )
        .bind(storeId)
        .all<{
          id: string;
          userId: string;
          username: string;
          displayName: string;
          email: string | null;
          phone: string | null;
          userStatus: 'ACTIVE' | 'DISABLED';
          membershipStatus: 'ACTIVE' | 'DISABLED';
          roleCode: string;
          roleName: string;
          isSystemRole: number;
          createdAt: number;
        }>(),

      this.db
        .prepare(
          `SELECT
             d.id, d.name, d.status, d.activated_by AS activatedBy,
             u.display_name AS activatedByName, d.activated_at AS activatedAt,
             d.revoked_at AS revokedAt, d.last_seen_at AS lastSeenAt,
             d.created_at AS createdAt
           FROM devices d
           LEFT JOIN users u ON u.id = d.activated_by
           WHERE d.store_id = ?
           ORDER BY d.created_at DESC`,
        )
        .bind(storeId)
        .all<{
          id: string;
          name: string;
          status: 'ACTIVE' | 'REVOKED';
          activatedBy: string;
          activatedByName: string | null;
          activatedAt: number;
          revokedAt: number | null;
          lastSeenAt: number | null;
          createdAt: number;
        }>(),

      this.db
        .prepare(
          `SELECT
             s.id, s.user_id AS userId, u.display_name AS userName, u.username AS userUsername,
             s.device_id AS deviceId, d.name AS deviceName,
             s.session_kind AS sessionKind, s.status,
             s.created_at AS createdAt, s.last_seen_at AS lastSeenAt,
             s.expires_at AS expiresAt, s.idle_expires_at AS idleExpiresAt
           FROM auth_sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN devices d ON d.id = s.device_id
           WHERE s.store_id = ? AND s.status = 'ACTIVE'
           ORDER BY s.last_seen_at DESC
           LIMIT 50`,
        )
        .bind(storeId)
        .all<{
          id: string;
          userId: string;
          userName: string;
          userUsername: string;
          deviceId: string | null;
          deviceName: string | null;
          sessionKind: 'SUPER_ADMIN' | 'OWNER' | 'EMPLOYEE';
          status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
          createdAt: number;
          lastSeenAt: number;
          expiresAt: number;
          idleExpiresAt: number;
        }>(),

      Promise.all([
        this.db
          .prepare('SELECT COUNT(*) AS count FROM areas WHERE store_id = ?')
          .bind(storeId)
          .first<{ count: number }>(),
        this.db
          .prepare(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status = 'IN_USE' THEN 1 ELSE 0 END) AS occupied
             FROM service_tables WHERE store_id = ?`,
          )
          .bind(storeId)
          .first<{ total: number; occupied: number | null }>(),
        this.db
          .prepare('SELECT COUNT(*) AS count FROM products WHERE store_id = ?')
          .bind(storeId)
          .first<{ count: number }>(),
        this.db
          .prepare(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open,
                    SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paid
             FROM orders WHERE store_id = ?`,
          )
          .bind(storeId)
          .first<{ total: number; open: number | null; paid: number | null }>(),
        this.db
          .prepare(
            `SELECT COUNT(*) AS total,
                    SUM(total) AS revenue
             FROM invoices WHERE store_id = ? AND status = 'COMPLETED'`,
          )
          .bind(storeId)
          .first<{ total: number; revenue: number | null }>(),
      ]),
    ]);

    const [areasCount, tablesCount, productsCount, ordersCount, invoicesCount] = stats;

    return {
      store: {
        id: store.id,
        name: store.name,
        status: store.status,
        timezone: store.timezone,
        createdAt: store.createdAt,
        updatedAt: store.updatedAt,
        posRealtimeEnabled: store.posRealtimeEnabled === 1,
        settings: store.currency
          ? {
              currency: store.currency,
              businessDayCutoffMinutes: store.businessDayCutoffMinutes ?? 0,
              phone: store.phone,
              address: store.address,
              provinceCode: store.provinceCode,
              provinceName: store.provinceName,
              wardCode: store.wardCode,
              wardName: store.wardName,
              bankName: store.bankName,
              bankAccountNumber: store.bankAccountNumber,
              bankAccountName: store.bankAccountName,
              bankQrMediaId: store.bankQrMediaId,
            }
          : null,
      },
      members: (members.results ?? []).map((m) => ({
        id: m.id,
        userId: m.userId,
        username: m.username,
        displayName: m.displayName,
        email: m.email,
        phone: m.phone,
        userStatus: m.userStatus,
        membershipStatus: m.membershipStatus,
        roleCode: m.roleCode,
        roleName: m.roleName,
        isSystemRole: m.isSystemRole === 1,
        createdAt: m.createdAt,
      })),
      devices: (devices.results ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status,
        activatedBy: d.activatedBy,
        activatedByName: d.activatedByName ?? 'Không rõ',
        activatedAt: d.activatedAt,
        revokedAt: d.revokedAt,
        lastSeenAt: d.lastSeenAt,
        createdAt: d.createdAt,
      })),
      sessions: (sessions.results ?? []).map((s) => ({
        id: s.id,
        userId: s.userId,
        userName: s.userName,
        userUsername: s.userUsername,
        deviceId: s.deviceId,
        deviceName: s.deviceName,
        sessionKind: s.sessionKind,
        status: s.status,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        idleExpiresAt: s.idleExpiresAt,
      })),
      stats: {
        totalAreas: areasCount?.count ?? 0,
        totalTables: tablesCount?.total ?? 0,
        openTables: tablesCount?.occupied ?? 0,
        totalProducts: productsCount?.count ?? 0,
        totalOrders: ordersCount?.total ?? 0,
        openOrders: ordersCount?.open ?? 0,
        paidOrders: ordersCount?.paid ?? 0,
        totalInvoices: invoicesCount?.total ?? 0,
        totalRevenue: invoicesCount?.revenue ?? 0,
      },
    };
  }

  async updateStoreMember(input: {
    storeId: string;
    userId: string;
    displayName?: string | undefined;
    username?: string | undefined;
    email?: string | null | undefined;
    phone?: string | null | undefined;
    status?: 'ACTIVE' | 'DISABLED' | undefined;
    password?:
      | {
          salt: string;
          digest: string;
          workFactor: number;
          pepperVersion: number;
        }
      | undefined;
    now: number;
  }) {
    const membership = await this.db
      .prepare(
        `SELECT sm.id, sm.user_id, sm.role_id, r.code AS role_code
         FROM store_memberships sm
         JOIN roles r ON r.id = sm.role_id
         WHERE sm.store_id = ? AND sm.user_id = ? LIMIT 1`,
      )
      .bind(input.storeId, input.userId)
      .first<{ id: string; user_id: string; role_id: string; role_code: string }>();

    if (!membership) return null;

    const statements: D1PreparedStatement[] = [];

    const userUpdates: string[] = ['updated_at = ?'];
    const userBindings: unknown[] = [input.now];

    if (input.displayName !== undefined) {
      userUpdates.push('display_name = ?');
      userBindings.push(input.displayName);
    }
    if (input.username !== undefined) {
      userUpdates.push('username = ?');
      userBindings.push(input.username);
    }
    if (input.email !== undefined) {
      userUpdates.push('email = ?');
      userBindings.push(input.email);
    }
    if (input.phone !== undefined) {
      userUpdates.push('phone = ?');
      userBindings.push(input.phone);
    }
    if (input.status !== undefined) {
      userUpdates.push('status = ?');
      userBindings.push(input.status);
    }

    userBindings.push(input.userId);
    statements.push(
      this.db
        .prepare(`UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`)
        .bind(...userBindings),
    );

    if (input.status !== undefined) {
      statements.push(
        this.db
          .prepare(
            'UPDATE store_memberships SET status = ?, updated_at = ? WHERE store_id = ? AND user_id = ?',
          )
          .bind(input.status, input.now, input.storeId, input.userId),
      );
    }

    if (input.password) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO password_credentials (
               user_id, algorithm, work_factor, salt, digest, pepper_version, credential_version, updated_at
             ) VALUES (?, 'PBKDF2-HMAC-SHA256', ?, ?, ?, ?, 1, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               salt = excluded.salt,
               digest = excluded.digest,
               work_factor = excluded.work_factor,
               pepper_version = excluded.pepper_version,
               credential_version = credential_version + 1,
               updated_at = excluded.updated_at`,
          )
          .bind(
            input.userId,
            input.password.workFactor,
            input.password.salt,
            input.password.digest,
            input.password.pepperVersion,
            input.now,
          ),
      );
    }

    await this.db.batch(statements);
    return { success: true };
  }
}
