import type {
  DatabaseStorageReport,
  DatabaseTableCategory,
  DatabaseTableStorageRow,
} from '@contracts/platform';

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionPolicy {
  operationalAuditDays: number;
  commandDays: number;
  posSaveCommandDays: number;
  publishedRealtimeDays: number;
  staffNotificationDays: number;
  terminalPrintJobDays: number;
  paymentSnapshotDays: number;
  operationalDataDays: number;
  mediaTombstoneDays: number;
  cleanupBatchSize: number;
  mediaCleanupBatchSize: number;
}

export const DEFAULT_RETENTION_POLICY = {
  operationalAuditDays: 7,
  commandDays: 7,
  posSaveCommandDays: 7,
  publishedRealtimeDays: 7,
  staffNotificationDays: 3,
  terminalPrintJobDays: 14,
  paymentSnapshotDays: 14,
  operationalDataDays: 7,
  mediaTombstoneDays: 7,
  cleanupBatchSize: 500,
  mediaCleanupBatchSize: 100,
} as const satisfies RetentionPolicy;

export interface MaintenanceCleanupResult {
  startedAtMs: number;
  durationMs: number;
  totalDeleted: number;
  policy: RetentionPolicy;
  cutoffs: Record<string, string>;
  tables: Record<string, number>;
}

export const OPERATIONAL_AUDIT_ACTIONS = [
  'TABLE_OPENED',
  'TAKEAWAY_ORDER_CREATED',
  'ORDER_ITEM_ADDED',
  'ORDER_ITEM_ADDED_WITH_DISCOUNT',
  'ORDER_ITEM_UPDATED',
  'ORDER_ITEM_REMOVED',
  'ORDER_NOTE_UPDATED',
  'TABLE_TRANSFERRED',
  'TIME_PAUSED',
  'TIME_RESUMED',
  'TIME_RANGE_UPDATED',
  'TIME_SESSION_REMOVED',
  'TIME_SESSION_RESTORED',
  'ORDER_CHECKOUT_PENDING',
  'ORDER_RESUMED_FROM_CHECKOUT',
  'CHECKOUT_COMPLETED',
  'ORDER_CANCELLED',
  'ORDER_BATCH_SAVED',
] as const;

const OPERATIONAL_AUDIT_ACTION_SQL = OPERATIONAL_AUDIT_ACTIONS.map((action) => `'${action}'`).join(
  ', ',
);

export const RETENTION_COMMAND_TABLES = [
  'open_table_commands',
  'create_takeaway_order_commands',
  'add_item_commands',
  'add_takeaway_item_commands',
  'update_order_item_commands',
  'remove_order_item_commands',
  'update_order_note_commands',
  'update_order_guest_commands',
  'pause_time_commands',
  'resume_time_commands',
  'create_time_session_commands',
  'remove_time_session_commands',
  'update_time_range_commands',
  'stop_time_commands',
  'resume_checkout_commands',
  'transfer_table_commands',
  'checkout_commands',
  'takeaway_checkout_commands',
  'cancel_order_commands',
  'cancel_takeaway_order_commands',
  'create_guest_order_request_commands',
  'accept_guest_order_request_commands',
  'reject_guest_order_request_commands',
] as const;

export interface DeletedMediaCandidate {
  id: string;
  objectKey: string;
}

export interface TableStorageMetadata {
  category: DatabaseTableCategory;
  retentionDays: number | null;
  retentionLabel: string;
  automaticallyCleaned: boolean;
}

export function getTableStorageMetadata(
  tableName: string,
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
): TableStorageMetadata {
  // Operational tables with specific retention windows
  if (tableName === 'pos_save_commands') {
    return {
      category: 'OPERATIONAL',
      retentionDays: policy.posSaveCommandDays,
      retentionLabel: `${policy.posSaveCommandDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (
    (RETENTION_COMMAND_TABLES as readonly string[]).includes(tableName) ||
    tableName === 'catalog_import_commands'
  ) {
    return {
      category: 'OPERATIONAL',
      retentionDays: policy.commandDays,
      retentionLabel: `${policy.commandDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (tableName === 'realtime_events') {
    return {
      category: 'OPERATIONAL',
      retentionDays: policy.publishedRealtimeDays,
      retentionLabel: `${policy.publishedRealtimeDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (
    tableName === 'realtime_event_requests' ||
    tableName === 'realtime_batch_contexts' ||
    tableName === 'pos_performance_sessions' ||
    tableName === 'revenue_report_print_snapshots' ||
    tableName === 'product_report_print_snapshots'
  ) {
    return {
      category: 'OPERATIONAL',
      retentionDays: policy.operationalDataDays,
      retentionLabel: `${policy.operationalDataDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (tableName === 'payment_snapshots') {
    return {
      category: 'OPERATIONAL',
      retentionDays: policy.paymentSnapshotDays,
      retentionLabel: `${policy.paymentSnapshotDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (tableName === 'print_jobs') {
    return {
      category: 'OPERATIONAL',
      retentionDays: policy.terminalPrintJobDays,
      retentionLabel: `${policy.terminalPrintJobDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (tableName === 'staff_notification_events') {
    return {
      category: 'OPERATIONAL',
      retentionDays: policy.staffNotificationDays,
      retentionLabel: `${policy.staffNotificationDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (tableName === 'order_call_batches' || tableName === 'order_call_batch_entries') {
    return {
      category: 'OPERATIONAL',
      retentionDays: policy.operationalDataDays,
      retentionLabel: `Đơn đã đóng: ${policy.operationalDataDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (
    tableName === 'guest_order_requests' ||
    tableName === 'guest_order_request_items' ||
    tableName === 'table_open_requests' ||
    tableName === 'service_requests'
  ) {
    return {
      category: 'OPERATIONAL',
      retentionDays: policy.operationalDataDays,
      retentionLabel: `Đã xử lý: ${policy.operationalDataDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (
    tableName === 'guest_order_sessions' ||
    tableName === 'activation_grants' ||
    tableName === 'access_auth_requests' ||
    tableName === 'print_agent_pairings'
  ) {
    return {
      category: 'OPERATIONAL',
      retentionDays: policy.operationalDataDays,
      retentionLabel: `Hết hạn: ${policy.operationalDataDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (tableName === 'media_objects') {
    return {
      category: 'OPERATIONAL',
      retentionDays: policy.mediaTombstoneDays,
      retentionLabel: `Đã xóa: ${policy.mediaTombstoneDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  // Security tables
  if (tableName === 'auth_sessions') {
    return {
      category: 'SECURITY',
      retentionDays: policy.operationalDataDays,
      retentionLabel: `Hết hạn: ${policy.operationalDataDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (tableName === 'login_attempts') {
    return {
      category: 'SECURITY',
      retentionDays: policy.operationalDataDays,
      retentionLabel: `${policy.operationalDataDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  if (
    [
      'users',
      'roles',
      'permissions',
      'role_permissions',
      'store_memberships',
      'password_credentials',
      'pin_credentials',
      'pin_verifiers',
      'access_identities',
      'device_credentials',
      'devices',
      'store_employee_usernames',
      'telegram_admin_links',
      'telegram_link_codes',
    ].includes(tableName)
  ) {
    return {
      category: 'SECURITY',
      retentionDays: null,
      retentionLabel: 'Không tự động xóa',
      automaticallyCleaned: false,
    };
  }

  // Financial tables
  if (
    [
      'invoices',
      'invoice_lines',
      'takeaway_invoices',
      'takeaway_invoice_lines',
      'payments',
      'takeaway_payments',
      'orders',
      'order_items',
      'takeaway_orders',
      'takeaway_order_items',
      'customer_debt_entries',
      'customer_loyalty_entries',
      'invoice_payment_allocations',
      'invoice_promotions',
      'order_promotions',
      'order_promotion_suppressions',
      'invoice_sequences',
      'order_sequences',
      'pricing_segments',
      'table_time_segments',
      'time_sessions',
      'time_pauses',
    ].includes(tableName)
  ) {
    return {
      category: 'FINANCIAL',
      retentionDays: null,
      retentionLabel: 'Không tự động xóa',
      automaticallyCleaned: false,
    };
  }

  // Configuration tables
  if (
    [
      'stores',
      'store_settings',
      'store_bank_accounts',
      'store_capabilities',
      'store_print_settings',
      'store_print_config_versions',
      'print_config_change_requests',
      'staff_notification_settings',
      'products',
      'product_variants',
      'categories',
      'units',
      'areas',
      'service_tables',
      'time_price_configs',
      'special_price_windows',
      'table_qr_codes',
      'qr_order_sales_hours',
      'qr_order_quick_reasons',
      'customer_loyalty_settings',
      'customer_groups',
      'customer_group_members',
      'customers',
      'promotions',
      'promotion_targets',
      'promotion_customer_groups',
      'print_agents',
      'push_subscriptions',
      'realtime_store_sequences',
    ].includes(tableName)
  ) {
    return {
      category: 'CONFIGURATION',
      retentionDays: null,
      retentionLabel: 'Không tự động xóa',
      automaticallyCleaned: false,
    };
  }

  // Audit logs (operational audit cleaned, security audit permanent)
  if (tableName === 'audit_logs') {
    return {
      category: 'OTHER',
      retentionDays: policy.operationalAuditDays,
      retentionLabel: `Vận hành: ${policy.operationalAuditDays} ngày`,
      automaticallyCleaned: true,
    };
  }

  // Fallback for any other unlisted table
  return {
    category: 'OTHER',
    retentionDays: null,
    retentionLabel: 'Không tự động xóa',
    automaticallyCleaned: false,
  };
}

export class MaintenanceRepository {
  constructor(private readonly db: D1Database) {}

  async runRetentionCleanup(
    policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
    startedAt = Date.now(),
  ): Promise<MaintenanceCleanupResult> {
    const cutoff = (days: number) => startedAt - days * DAY_MS;
    const operationalCutoff = cutoff(policy.operationalDataDays);
    const commandCutoff = cutoff(policy.commandDays);
    const auditCutoff = cutoff(policy.operationalAuditDays);
    const realtimeCutoff = cutoff(policy.publishedRealtimeDays);
    const notificationCutoff = cutoff(policy.staffNotificationDays);
    const printJobCutoff = cutoff(policy.terminalPrintJobDays);
    const paymentSnapshotCutoff = cutoff(policy.paymentSnapshotDays);
    const tableStats: Record<string, number> = {};
    const remove = async (table: string, sql: string, ...bindings: unknown[]) => {
      const result = await this.db
        .prepare(sql)
        .bind(...bindings)
        .run();
      tableStats[table] = (tableStats[table] ?? 0) + (result.meta?.changes ?? 0);
    };
    const removeBatch = async (
      table: string,
      whereSql: string,
      orderBy: string,
      ...bindings: unknown[]
    ) =>
      remove(
        table,
        `DELETE FROM ${table}
         WHERE rowid IN (
           SELECT rowid FROM ${table}
           WHERE ${whereSql}
           ORDER BY ${orderBy}
           LIMIT ?
         )`,
        ...bindings,
        policy.cleanupBatchSize,
      );

    // Only high-volume POS operational audit is short-lived. Security, configuration,
    // user/role/permission, bank, catalog and media audit remains permanent.
    await removeBatch(
      'audit_logs',
      `action IN (${OPERATIONAL_AUDIT_ACTION_SQL}) AND created_at < ?`,
      'created_at ASC',
      auditCutoff,
    );
    await removeBatch(
      'staff_notification_events',
      'expires_at <= ? OR created_at < ?',
      'created_at ASC',
      startedAt,
      notificationCutoff,
    );
    await removeBatch(
      'realtime_events',
      'published_at IS NOT NULL AND published_at < ?',
      'published_at ASC',
      realtimeCutoff,
    );
    await removeBatch(
      'realtime_event_requests',
      'occurred_at < ?',
      'occurred_at ASC',
      operationalCutoff,
    );
    await removeBatch(
      'print_jobs',
      `status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'UNCERTAIN')
       AND COALESCE(completed_at, failed_at, created_at) < ?`,
      'COALESCE(completed_at, failed_at, created_at) ASC',
      printJobCutoff,
    );
    await removeBatch(
      'revenue_report_print_snapshots',
      'expires_at <= ? OR created_at < ?',
      'created_at ASC',
      startedAt,
      operationalCutoff,
    );
    await removeBatch(
      'product_report_print_snapshots',
      'expires_at <= ? OR created_at < ?',
      'created_at ASC',
      startedAt,
      operationalCutoff,
    );

    // Remove terminal QR-order data child-first. Pending requests are always retained.
    const terminalGuestRequests = `
      SELECT id FROM guest_order_requests
      WHERE status IN ('ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED')
        AND created_at < ?
      ORDER BY created_at ASC
      LIMIT ?`;
    await remove(
      'accept_guest_order_request_commands',
      `DELETE FROM accept_guest_order_request_commands
       WHERE guest_request_id IN (${terminalGuestRequests})`,
      operationalCutoff,
      policy.cleanupBatchSize,
    );
    await remove(
      'reject_guest_order_request_commands',
      `DELETE FROM reject_guest_order_request_commands
       WHERE guest_request_id IN (${terminalGuestRequests})`,
      operationalCutoff,
      policy.cleanupBatchSize,
    );
    await remove(
      'guest_order_request_items',
      `DELETE FROM guest_order_request_items
       WHERE request_id IN (${terminalGuestRequests})`,
      operationalCutoff,
      policy.cleanupBatchSize,
    );
    await removeBatch(
      'guest_order_requests',
      `status IN ('ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED') AND created_at < ?`,
      'created_at ASC',
      operationalCutoff,
    );
    await removeBatch(
      'service_requests',
      `status IN ('COMPLETED', 'CANCELLED') AND created_at < ?`,
      'created_at ASC',
      operationalCutoff,
    );
    await removeBatch(
      'table_open_requests',
      `status IN ('COMPLETED', 'CANCELLED') AND created_at < ?`,
      'created_at ASC',
      operationalCutoff,
    );

    // Command rows are replay/idempotency history, never financial/order history.
    for (const commandTable of RETENTION_COMMAND_TABLES) {
      // eslint-disable-next-line no-await-in-loop -- dependency-safe cleanup order is intentional.
      await removeBatch(commandTable, 'issued_at < ?', 'issued_at ASC', commandCutoff);
    }
    await removeBatch(
      'pos_save_commands',
      'created_at < ?',
      'created_at ASC',
      cutoff(policy.posSaveCommandDays),
    );
    await removeBatch(
      'pos_performance_sessions',
      'received_at < ?',
      'received_at ASC',
      operationalCutoff,
    );
    await removeBatch(
      'realtime_batch_contexts',
      'created_at < ?',
      'created_at ASC',
      operationalCutoff,
    );
    await removeBatch('catalog_import_commands', 'created_at < ?', 'created_at ASC', commandCutoff);
    await removeBatch(
      'payment_snapshots',
      `status IN ('CONSUMED', 'INVALIDATED') AND created_at < ?`,
      'created_at ASC',
      paymentSnapshotCutoff,
    );

    // Call batches remain available for active orders, even when an order lasts beyond retention.
    // Batches are eligible when older than retention AND either:
    // (A) The parent order is in a terminal state (PAID or CANCELLED)
    // (B) The parent order no longer exists (orphaned batch)
    const closedCallBatches = `
      SELECT batch.id FROM order_call_batches batch
      WHERE batch.created_at < ?
        AND (
          (batch.order_type = 'DINE_IN' AND (
            EXISTS (
              SELECT 1 FROM orders order_row
              WHERE order_row.id = batch.order_id AND order_row.store_id = batch.store_id
                AND order_row.status IN ('PAID', 'CANCELLED')
            )
            OR NOT EXISTS (
              SELECT 1 FROM orders order_row
              WHERE order_row.id = batch.order_id AND order_row.store_id = batch.store_id
            )
          ))
          OR
          (batch.order_type = 'TAKEAWAY' AND (
            EXISTS (
              SELECT 1 FROM takeaway_orders order_row
              WHERE order_row.id = batch.order_id AND order_row.store_id = batch.store_id
                AND order_row.status IN ('PAID', 'CANCELLED')
            )
            OR NOT EXISTS (
              SELECT 1 FROM takeaway_orders order_row
              WHERE order_row.id = batch.order_id AND order_row.store_id = batch.store_id
            )
          ))
        )
      ORDER BY batch.created_at ASC
      LIMIT ?`;
    await remove(
      'order_call_batch_entries',
      `DELETE FROM order_call_batch_entries WHERE batch_id IN (${closedCallBatches})`,
      operationalCutoff,
      policy.cleanupBatchSize,
    );
    await remove(
      'order_call_batches',
      `DELETE FROM order_call_batches WHERE id IN (${closedCallBatches})`,
      operationalCutoff,
      policy.cleanupBatchSize,
    );

    await removeBatch(
      'guest_order_sessions',
      `(status IN ('EXPIRED', 'REVOKED') OR expires_at < ?) AND expires_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM guest_order_requests request
         WHERE request.guest_session_id = guest_order_sessions.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM service_requests request
         WHERE request.guest_session_id = guest_order_sessions.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM create_guest_order_request_commands command
         WHERE command.guest_session_id = guest_order_sessions.id
       )`,
      'expires_at ASC',
      startedAt,
      operationalCutoff,
    );
    await removeBatch(
      'auth_sessions',
      `(status IN ('EXPIRED', 'REVOKED') OR expires_at < ?) AND last_seen_at < ?
       AND NOT EXISTS (SELECT 1 FROM audit_logs log WHERE log.actor_session_id = auth_sessions.id)
       AND NOT EXISTS (SELECT 1 FROM pause_time_commands command WHERE command.actor_session_id = auth_sessions.id)
       AND NOT EXISTS (SELECT 1 FROM resume_time_commands command WHERE command.actor_session_id = auth_sessions.id)
       AND NOT EXISTS (SELECT 1 FROM create_time_session_commands command WHERE command.actor_session_id = auth_sessions.id)
       AND NOT EXISTS (SELECT 1 FROM remove_time_session_commands command WHERE command.actor_session_id = auth_sessions.id)
       AND NOT EXISTS (SELECT 1 FROM update_time_range_commands command WHERE command.actor_session_id = auth_sessions.id)
       AND NOT EXISTS (SELECT 1 FROM stop_time_commands command WHERE command.actor_session_id = auth_sessions.id)
       AND NOT EXISTS (SELECT 1 FROM resume_checkout_commands command WHERE command.actor_session_id = auth_sessions.id)
       AND NOT EXISTS (SELECT 1 FROM accept_guest_order_request_commands command WHERE command.actor_session_id = auth_sessions.id)
       AND NOT EXISTS (SELECT 1 FROM reject_guest_order_request_commands command WHERE command.actor_session_id = auth_sessions.id)`,
      'last_seen_at ASC',
      startedAt,
      operationalCutoff,
    );
    await removeBatch(
      'login_attempts',
      'updated_at < ? AND (locked_until IS NULL OR locked_until < ?)',
      'updated_at ASC',
      operationalCutoff,
      startedAt,
    );
    await removeBatch(
      'activation_grants',
      `status IN ('CONSUMED', 'EXPIRED', 'CANCELLED')
       AND (created_at < ? OR expires_at < ?)`,
      'created_at ASC',
      operationalCutoff,
      operationalCutoff,
    );
    await removeBatch(
      'access_auth_requests',
      'expires_at < ? OR created_at < ?',
      'created_at ASC',
      startedAt,
      operationalCutoff,
    );
    await removeBatch(
      'print_agent_pairings',
      `(status IN ('APPROVED', 'EXPIRED') OR expires_at < ?)
       AND (expires_at < ? OR created_at < ?)`,
      'created_at ASC',
      startedAt,
      operationalCutoff,
      operationalCutoff,
    );

    return {
      startedAtMs: startedAt,
      durationMs: Date.now() - startedAt,
      totalDeleted: Object.values(tableStats).reduce((total, count) => total + count, 0),
      policy,
      cutoffs: {
        operationalAudit: new Date(auditCutoff).toISOString(),
        commands: new Date(commandCutoff).toISOString(),
        posSaveCommands: new Date(cutoff(policy.posSaveCommandDays)).toISOString(),
        publishedRealtime: new Date(realtimeCutoff).toISOString(),
        staffNotifications: new Date(notificationCutoff).toISOString(),
        terminalPrintJobs: new Date(printJobCutoff).toISOString(),
        paymentSnapshots: new Date(paymentSnapshotCutoff).toISOString(),
        operationalData: new Date(operationalCutoff).toISOString(),
        mediaTombstones: new Date(cutoff(policy.mediaTombstoneDays)).toISOString(),
      },
      tables: tableStats,
    };
  }

  async listDeletedMediaBefore(beforeMs: number, limit: number): Promise<DeletedMediaCandidate[]> {
    const result = await this.db
      .prepare(
        `SELECT id, object_key AS objectKey
         FROM media_objects
         WHERE status = 'DELETED' AND deleted_at < ?
         ORDER BY deleted_at ASC
         LIMIT ?`,
      )
      .bind(beforeMs, limit)
      .all<DeletedMediaCandidate>();
    return result.results;
  }

  async deleteMediaTombstone(id: string, objectKey: string): Promise<number> {
    const result = await this.db
      .prepare(
        `DELETE FROM media_objects
         WHERE id = ? AND object_key = ? AND status = 'DELETED'`,
      )
      .bind(id, objectKey)
      .run();
    return result.meta?.changes ?? 0;
  }

  async getStorageReport(
    policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
  ): Promise<DatabaseStorageReport> {
    const capturedAt = Date.now();

    // 1. Get all non-internal tables and their index count from sqlite_master
    const schemaResult = await this.db
      .prepare(
        `SELECT
           m.name AS tableName,
           (SELECT COUNT(*) FROM sqlite_master i WHERE i.type = 'index' AND i.tbl_name = m.name AND i.name NOT LIKE 'sqlite_%') AS indexCount
         FROM sqlite_master m
         WHERE m.type = 'table'
           AND m.name NOT LIKE 'sqlite_%'
           AND m.name NOT LIKE '_d1_%'
           AND m.name NOT LIKE '_cf_%'
         ORDER BY m.name ASC`,
      )
      .all<{ tableName: string; indexCount: number }>();

    const tables = (schemaResult.results || []).filter((t) => /^[a-zA-Z0-9_]+$/.test(t.tableName));

    if (tables.length === 0) {
      return {
        capturedAt,
        databaseSizeBytes: null,
        tableCount: 0,
        totalEstimatedDataBytes: 0,
        tables: [],
      };
    }

    let databaseSizeBytes: number | null = null;
    if (typeof schemaResult.meta?.size_after === 'number' && schemaResult.meta.size_after > 0) {
      databaseSizeBytes = schemaResult.meta.size_after;
    }

    // 2. Fetch column names for each table using PRAGMA table_info in bounded batches
    const CHUNK_SIZE = 25;
    const tableColumns = new Map<string, string[]>();

    for (let i = 0; i < tables.length; i += CHUNK_SIZE) {
      const chunk = tables.slice(i, i + CHUNK_SIZE);
      const pragmaStatements = chunk.map((t) =>
        this.db.prepare(`PRAGMA table_info("${t.tableName.replace(/"/g, '""')}")`),
      );
      const pragmaBatchResults = await this.db.batch<{ name: string }>(pragmaStatements);
      for (let j = 0; j < chunk.length; j++) {
        const t = chunk[j];
        if (!t) continue;
        const cols = (pragmaBatchResults[j]?.results || [])
          .map((r) => r.name)
          .filter((name) => /^[a-zA-Z0-9_]+$/.test(name));
        tableColumns.set(t.tableName, cols);
      }
    }

    // 3. Batch aggregate queries
    const tableStats = new Map<string, { rowCount: number; estimatedBytes: number }>();
    const aggregateStatements = tables.map((t) => {
      const cols = tableColumns.get(t.tableName) || [];
      const sumExpr =
        cols.length > 0
          ? cols.map((c) => `COALESCE(length("${c.replace(/"/g, '""')}"), 0)`).join(' + ')
          : '0';
      return this.db.prepare(
        `SELECT
           COUNT(*) AS rowCount,
           COALESCE(SUM(${sumExpr}), 0) AS estimatedBytes
         FROM "${t.tableName.replace(/"/g, '""')}"`,
      );
    });

    for (let i = 0; i < aggregateStatements.length; i += CHUNK_SIZE) {
      const chunk = aggregateStatements.slice(i, i + CHUNK_SIZE);
      const chunkTables = tables.slice(i, i + CHUNK_SIZE);
      const batchResults = await this.db.batch<{ rowCount: number; estimatedBytes: number }>(chunk);
      for (let j = 0; j < chunkTables.length; j++) {
        const t = chunkTables[j];
        if (!t) continue;
        const res = batchResults[j]?.results?.[0];
        tableStats.set(t.tableName, {
          rowCount: Number(res?.rowCount || 0),
          estimatedBytes: Number(res?.estimatedBytes || 0),
        });
        if (
          databaseSizeBytes === null &&
          typeof batchResults[j]?.meta?.size_after === 'number' &&
          (batchResults[j]?.meta?.size_after ?? 0) > 0
        ) {
          databaseSizeBytes = batchResults[j]?.meta?.size_after ?? null;
        }
      }
    }

    // 4. Calculate total estimated data bytes
    let totalEstimatedDataBytes = 0;
    for (const stats of tableStats.values()) {
      totalEstimatedDataBytes += stats.estimatedBytes;
    }

    // 5. Construct rows
    const rows: DatabaseTableStorageRow[] = tables.map((t) => {
      const stats = tableStats.get(t.tableName) || { rowCount: 0, estimatedBytes: 0 };
      const meta = getTableStorageMetadata(t.tableName, policy);
      const estimatedSharePercent =
        totalEstimatedDataBytes > 0
          ? Number(((stats.estimatedBytes / totalEstimatedDataBytes) * 100).toFixed(2))
          : 0;
      const averageRowBytes =
        stats.rowCount > 0 ? Math.round(stats.estimatedBytes / stats.rowCount) : 0;

      return {
        tableName: t.tableName,
        rowCount: stats.rowCount,
        estimatedDataBytes: stats.estimatedBytes,
        averageRowBytes,
        estimatedSharePercent,
        indexCount: Number(t.indexCount || 0),
        category: meta.category,
        retentionDays: meta.retentionDays,
        retentionLabel: meta.retentionLabel,
        automaticallyCleaned: meta.automaticallyCleaned,
      };
    });

    // 6. Sort descending: estimatedDataBytes DESC, rowCount DESC, tableName ASC
    rows.sort((a, b) => {
      if (b.estimatedDataBytes !== a.estimatedDataBytes) {
        return b.estimatedDataBytes - a.estimatedDataBytes;
      }
      if (b.rowCount !== a.rowCount) {
        return b.rowCount - a.rowCount;
      }
      return a.tableName.localeCompare(b.tableName);
    });

    return {
      capturedAt,
      databaseSizeBytes,
      tableCount: rows.length,
      totalEstimatedDataBytes,
      tables: rows,
    };
  }
}
