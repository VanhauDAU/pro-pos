export interface MaintenanceCleanupResult {
  cutoffMs: number;
  cutoffDate: string;
  retentionDays: number;
  durationMs: number;
  totalDeleted: number;
  tables: Record<string, number>;
}

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

export class MaintenanceRepository {
  constructor(private readonly db: D1Database) {}

  async runRetentionCleanup(retentionDays = 7): Promise<MaintenanceCleanupResult> {
    const startedAt = Date.now();
    const cutoff = startedAt - retentionDays * 24 * 60 * 60 * 1000;
    const tableStats: Record<string, number> = {};
    const remove = async (table: string, sql: string, ...bindings: unknown[]) => {
      const result = await this.db
        .prepare(sql)
        .bind(...bindings)
        .run();
      tableStats[table] = (tableStats[table] ?? 0) + (result.meta?.changes ?? 0);
    };

    // Operational logs and delivered realtime data have no business value after retention.
    await remove('audit_logs', 'DELETE FROM audit_logs WHERE created_at < ?', cutoff);
    await remove(
      'staff_notification_events',
      'DELETE FROM staff_notification_events WHERE expires_at <= ? OR created_at < ?',
      startedAt,
      cutoff,
    );
    await remove(
      'realtime_events',
      `DELETE FROM realtime_events
       WHERE published_at IS NOT NULL AND (published_at < ? OR occurred_at < ?)`,
      cutoff,
      cutoff,
    );
    await remove(
      'realtime_event_requests',
      'DELETE FROM realtime_event_requests WHERE occurred_at < ?',
      cutoff,
    );
    await remove(
      'media_objects',
      "DELETE FROM media_objects WHERE status = 'DELETED' AND deleted_at < ?",
      cutoff,
    );
    await remove(
      'print_jobs',
      `DELETE FROM print_jobs
       WHERE (status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'UNCERTAIN') AND (completed_at < ? OR failed_at < ? OR created_at < ?))
          OR created_at < ?`,
      cutoff,
      cutoff,
      cutoff,
      cutoff,
    );

    // Remove terminal QR-order data child-first. Pending requests are always retained.
    const terminalGuestRequests = `
      SELECT id FROM guest_order_requests
      WHERE status IN ('ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED')
        AND created_at < ?`;
    await remove(
      'accept_guest_order_request_commands',
      `DELETE FROM accept_guest_order_request_commands
       WHERE guest_request_id IN (${terminalGuestRequests})`,
      cutoff,
    );
    await remove(
      'reject_guest_order_request_commands',
      `DELETE FROM reject_guest_order_request_commands
       WHERE guest_request_id IN (${terminalGuestRequests})`,
      cutoff,
    );
    await remove(
      'guest_order_request_items',
      `DELETE FROM guest_order_request_items
       WHERE request_id IN (${terminalGuestRequests})`,
      cutoff,
    );
    await remove(
      'guest_order_requests',
      `DELETE FROM guest_order_requests
       WHERE status IN ('ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED')
         AND created_at < ?`,
      cutoff,
    );
    await remove(
      'service_requests',
      `DELETE FROM service_requests
       WHERE status IN ('COMPLETED', 'CANCELLED') AND created_at < ?`,
      cutoff,
    );
    await remove(
      'table_open_requests',
      `DELETE FROM table_open_requests
       WHERE status IN ('COMPLETED', 'CANCELLED') AND created_at < ?`,
      cutoff,
    );

    // Command rows are idempotency/operational history, not financial records.
    // Delete them before auth/guest sessions because several commands reference those sessions.
    for (const commandTable of RETENTION_COMMAND_TABLES) {
      // eslint-disable-next-line no-await-in-loop -- dependency-safe cleanup order is intentional.
      await remove(commandTable, `DELETE FROM ${commandTable} WHERE issued_at < ?`, cutoff);
    }
    await remove('pos_save_commands', 'DELETE FROM pos_save_commands WHERE created_at < ?', cutoff);
    await remove(
      'pos_performance_sessions',
      'DELETE FROM pos_performance_sessions WHERE received_at < ?',
      cutoff,
    );
    await remove(
      'realtime_batch_contexts',
      'DELETE FROM realtime_batch_contexts WHERE created_at < ?',
      cutoff,
    );
    await remove(
      'catalog_import_commands',
      'DELETE FROM catalog_import_commands WHERE created_at < ?',
      cutoff,
    );
    await remove(
      'payment_snapshots',
      `DELETE FROM payment_snapshots
       WHERE status IN ('CONSUMED', 'INVALIDATED') AND created_at < ?`,
      cutoff,
    );

    // Call batches remain available for active orders, even when an order lasts longer than 7 days.
    const closedCallBatches = `
      SELECT batch.id FROM order_call_batches batch
      WHERE batch.created_at < ?
        AND (
          (batch.order_type = 'DINE_IN' AND EXISTS (
            SELECT 1 FROM orders order_row
            WHERE order_row.id = batch.order_id AND order_row.store_id = batch.store_id
              AND order_row.status IN ('PAID', 'CANCELLED')
          ))
          OR
          (batch.order_type = 'TAKEAWAY' AND EXISTS (
            SELECT 1 FROM takeaway_orders order_row
            WHERE order_row.id = batch.order_id AND order_row.store_id = batch.store_id
              AND order_row.status IN ('PAID', 'CANCELLED')
          ))
        )`;
    await remove(
      'order_call_batch_entries',
      `DELETE FROM order_call_batch_entries WHERE batch_id IN (${closedCallBatches})`,
      cutoff,
    );
    await remove(
      'order_call_batches',
      `DELETE FROM order_call_batches WHERE id IN (${closedCallBatches})`,
      cutoff,
    );

    await remove(
      'guest_order_sessions',
      `DELETE FROM guest_order_sessions
       WHERE (status IN ('EXPIRED', 'REVOKED') OR expires_at < ?) AND expires_at < ?
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
      startedAt,
      cutoff,
    );
    await remove(
      'auth_sessions',
      `DELETE FROM auth_sessions
       WHERE (status IN ('EXPIRED', 'REVOKED') OR expires_at < ?) AND last_seen_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM audit_logs log WHERE log.actor_session_id = auth_sessions.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM pause_time_commands command
           WHERE command.actor_session_id = auth_sessions.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM resume_time_commands command
           WHERE command.actor_session_id = auth_sessions.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM create_time_session_commands command
           WHERE command.actor_session_id = auth_sessions.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM remove_time_session_commands command
           WHERE command.actor_session_id = auth_sessions.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM update_time_range_commands command
           WHERE command.actor_session_id = auth_sessions.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM stop_time_commands command
           WHERE command.actor_session_id = auth_sessions.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM resume_checkout_commands command
           WHERE command.actor_session_id = auth_sessions.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM accept_guest_order_request_commands command
           WHERE command.actor_session_id = auth_sessions.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM reject_guest_order_request_commands command
           WHERE command.actor_session_id = auth_sessions.id
         )`,
      startedAt,
      cutoff,
    );
    await remove(
      'login_attempts',
      `DELETE FROM login_attempts
       WHERE updated_at < ? AND (locked_until IS NULL OR locked_until < ?)`,
      cutoff,
      startedAt,
    );
    await remove(
      'activation_grants',
      `DELETE FROM activation_grants
       WHERE status IN ('CONSUMED', 'EXPIRED', 'CANCELLED')
         AND (created_at < ? OR expires_at < ?)`,
      cutoff,
      cutoff,
    );
    await remove(
      'access_auth_requests',
      'DELETE FROM access_auth_requests WHERE expires_at < ? OR created_at < ?',
      startedAt,
      cutoff,
    );
    await remove(
      'print_agent_pairings',
      `DELETE FROM print_agent_pairings
       WHERE (status IN ('APPROVED', 'EXPIRED') OR expires_at < ?)
         AND (expires_at < ? OR created_at < ?)`,
      startedAt,
      cutoff,
      cutoff,
    );

    return {
      cutoffMs: cutoff,
      cutoffDate: new Date(cutoff).toISOString(),
      retentionDays,
      durationMs: Date.now() - startedAt,
      totalDeleted: Object.values(tableStats).reduce((total, count) => total + count, 0),
      tables: tableStats,
    };
  }
}
