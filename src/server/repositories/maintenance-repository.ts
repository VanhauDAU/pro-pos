export interface MaintenanceCleanupResult {
  cutoffMs: number;
  cutoffDate: string;
  retentionDays: number;
  durationMs: number;
  totalDeleted: number;
  tables: Record<string, number>;
}

export class MaintenanceRepository {
  constructor(private readonly db: D1Database) {}

  async runRetentionCleanup(retentionDays = 7): Promise<MaintenanceCleanupResult> {
    const startedAt = Date.now();
    const cutoff = startedAt - retentionDays * 24 * 60 * 60 * 1000;
    const tableStats: Record<string, number> = {};

    // 1. Audit Logs
    const rAudit = await this.db
      .prepare('DELETE FROM audit_logs WHERE created_at < ?')
      .bind(cutoff)
      .run();
    tableStats['audit_logs'] = rAudit.meta?.changes ?? 0;

    // 2. Staff Notification Events
    const rNotif = await this.db
      .prepare('DELETE FROM staff_notification_events WHERE expires_at <= ? OR created_at < ?')
      .bind(startedAt, cutoff)
      .run();
    tableStats['staff_notification_events'] = rNotif.meta?.changes ?? 0;

    // 3. Realtime Broadcast Events & Requests
    const rRtEvents = await this.db
      .prepare(
        'DELETE FROM realtime_events WHERE published_at IS NOT NULL AND (published_at < ? OR occurred_at < ?)',
      )
      .bind(cutoff, cutoff)
      .run();
    tableStats['realtime_events'] = rRtEvents.meta?.changes ?? 0;

    const rRtReq = await this.db
      .prepare('DELETE FROM realtime_event_requests WHERE occurred_at < ?')
      .bind(cutoff)
      .run();
    tableStats['realtime_event_requests'] = rRtReq.meta?.changes ?? 0;

    // 4. Inactive / Expired / Revoked Auth Sessions
    const rSessions = await this.db
      .prepare(
        "DELETE FROM auth_sessions WHERE (status IN ('EXPIRED', 'REVOKED') OR expires_at < ?) AND last_seen_at < ?",
      )
      .bind(startedAt, cutoff)
      .run();
    tableStats['auth_sessions'] = rSessions.meta?.changes ?? 0;

    // 5. Outdated Login Attempts
    const rLoginAttempts = await this.db
      .prepare(
        'DELETE FROM login_attempts WHERE updated_at < ? AND (locked_until IS NULL OR locked_until < ?)',
      )
      .bind(cutoff, startedAt)
      .run();
    tableStats['login_attempts'] = rLoginAttempts.meta?.changes ?? 0;

    // 6. Consumed / Expired Activation Grants
    const rGrants = await this.db
      .prepare(
        "DELETE FROM activation_grants WHERE status IN ('CONSUMED', 'EXPIRED', 'CANCELLED') AND (created_at < ? OR expires_at < ?)",
      )
      .bind(cutoff, cutoff)
      .run();
    tableStats['activation_grants'] = rGrants.meta?.changes ?? 0;

    // 7. Expired Access Auth Requests
    const rAccessAuth = await this.db
      .prepare('DELETE FROM access_auth_requests WHERE expires_at < ? OR created_at < ?')
      .bind(startedAt, cutoff)
      .run();
    tableStats['access_auth_requests'] = rAccessAuth.meta?.changes ?? 0;

    // 8. Handled / Cancelled Service Requests
    const rServiceReq = await this.db
      .prepare(
        "DELETE FROM service_requests WHERE status IN ('COMPLETED', 'CANCELLED') AND created_at < ?",
      )
      .bind(cutoff)
      .run();
    tableStats['service_requests'] = rServiceReq.meta?.changes ?? 0;

    // 9. Handled / Rejected Guest Order Requests
    const rGuestOrderItems = await this.db
      .prepare(
        `DELETE FROM guest_order_request_items WHERE request_id IN (
           SELECT id FROM guest_order_requests
           WHERE status IN ('ACCEPTED', 'REJECTED', 'CANCELLED') AND created_at < ?
         )`,
      )
      .bind(cutoff)
      .run();
    tableStats['guest_order_request_items'] = rGuestOrderItems.meta?.changes ?? 0;

    const rGuestOrders = await this.db
      .prepare(
        "DELETE FROM guest_order_requests WHERE status IN ('ACCEPTED', 'REJECTED', 'CANCELLED') AND created_at < ?",
      )
      .bind(cutoff)
      .run();
    tableStats['guest_order_requests'] = rGuestOrders.meta?.changes ?? 0;

    // 10. Expired Guest Order Sessions
    const rGuestSessions = await this.db
      .prepare(
        "DELETE FROM guest_order_sessions WHERE (status IN ('EXPIRED', 'REVOKED') OR expires_at < ?) AND expires_at < ?",
      )
      .bind(startedAt, cutoff)
      .run();
    tableStats['guest_order_sessions'] = rGuestSessions.meta?.changes ?? 0;

    // 11. Command history tables (Settled / Completed POS and QR operation commands)
    const commandTables = [
      'create_takeaway_order_commands',
      'add_takeaway_item_commands',
      'update_order_item_commands',
      'remove_order_item_commands',
      'update_order_note_commands',
      'update_order_guest_commands',
      'takeaway_checkout_commands',
      'cancel_takeaway_order_commands',
      'create_time_session_commands',
      'remove_time_session_commands',
      'update_time_range_commands',
      'stop_time_commands',
      'resume_checkout_commands',
      'create_guest_order_request_commands',
      'accept_guest_order_request_commands',
      'reject_guest_order_request_commands',
    ];

    for (const cmdTable of commandTables) {
      try {
        const rCmd = await this.db
          .prepare(`DELETE FROM ${cmdTable} WHERE issued_at < ?`)
          .bind(cutoff)
          .run();
        tableStats[cmdTable] = rCmd.meta?.changes ?? 0;
      } catch {
        // Continue if table doesn't match
      }
    }

    const totalDeleted = Object.values(tableStats).reduce((acc, count) => acc + count, 0);

    return {
      cutoffMs: cutoff,
      cutoffDate: new Date(cutoff).toISOString(),
      retentionDays,
      durationMs: Date.now() - startedAt,
      totalDeleted,
      tables: tableStats,
    };
  }
}
