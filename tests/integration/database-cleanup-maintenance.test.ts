import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { MaintenanceService } from '@server/services/maintenance-service';

describe('7-Day Database Retention Cleanup Maintenance', () => {
  it('cleans up logs, sessions, and events older than 7 days while keeping active data', async () => {
    const now = Date.now();
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    const inTwoDays = now + 2 * 24 * 60 * 60 * 1000;

    const storeId = `store-cleanup-test-${Math.random().toString(36).slice(2, 8)}`;
    const userId = `user-cleanup-test-${Math.random().toString(36).slice(2, 8)}`;

    // Create minimal store and user for foreign key integrity
    await env.DB.prepare(
      `INSERT INTO stores (id, name, status, created_at, updated_at)
       VALUES (?, ?, 'ACTIVE', ?, ?)`,
    )
      .bind(storeId, 'Store Cleanup Test', now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO users (id, username, display_name, status, created_at, updated_at)
       VALUES (?, ?, 'User Cleanup Test', 'ACTIVE', ?, ?)`,
    )
      .bind(userId, `user_${Math.random().toString(36).slice(2, 6)}`, now, now)
      .run();

    // 1. Audit logs: 1 old (10 days), 1 fresh (2 days)
    const oldAuditId = `audit-old-${Math.random().toString(36).slice(2, 8)}`;
    const newAuditId = `audit-new-${Math.random().toString(36).slice(2, 8)}`;

    await env.DB.prepare(
      `INSERT INTO audit_logs (id, store_id, actor_user_id, action, entity_type, entity_id, request_id, created_at)
       VALUES (?, ?, ?, 'USER_LOGIN', 'USER', ?, 'req-1', ?)`,
    )
      .bind(oldAuditId, storeId, userId, userId, tenDaysAgo)
      .run();

    await env.DB.prepare(
      `INSERT INTO audit_logs (id, store_id, actor_user_id, action, entity_type, entity_id, request_id, created_at)
       VALUES (?, ?, ?, 'USER_LOGIN', 'USER', ?, 'req-2', ?)`,
    )
      .bind(newAuditId, storeId, userId, userId, twoDaysAgo)
      .run();

    // 2. Staff notification events: 1 expired old, 1 active
    const oldNotifId = `notif-old-${Math.random().toString(36).slice(2, 8)}`;
    const newNotifId = `notif-new-${Math.random().toString(36).slice(2, 8)}`;

    await env.DB.prepare(
      `INSERT INTO staff_notification_events (
         id, store_id, source_type, source_id, event_type, status,
         order_id, table_id, table_name_snapshot, area_name_snapshot,
         summary, created_at, expires_at
       ) VALUES (?, ?, 'GUEST_ORDER', ?, 'QR_ORDER', 'EXPIRED', 'ord-1', 'tbl-1', 'Bàn 1', 'Tầng 1', 'Đơn cũ', ?, ?)`,
    )
      .bind(oldNotifId, storeId, `src-old-${Math.random()}`, tenDaysAgo, tenDaysAgo + 3600_000)
      .run();

    await env.DB.prepare(
      `INSERT INTO staff_notification_events (
         id, store_id, source_type, source_id, event_type, status,
         order_id, table_id, table_name_snapshot, area_name_snapshot,
         summary, created_at, expires_at
       ) VALUES (?, ?, 'GUEST_ORDER', ?, 'QR_ORDER', 'OPEN', 'ord-2', 'tbl-1', 'Bàn 1', 'Tầng 1', 'Đơn mới', ?, ?)`,
    )
      .bind(newNotifId, storeId, `src-new-${Math.random()}`, twoDaysAgo, inTwoDays)
      .run();

    // 3. Realtime events: 1 published 10 days ago, 1 published 2 days ago
    const oldRtId = `rt-old-${Math.random().toString(36).slice(2, 8)}`;
    const newRtId = `rt-new-${Math.random().toString(36).slice(2, 8)}`;

    await env.DB.prepare(
      `INSERT INTO realtime_events (
         event_id, store_id, sequence, schema_version, event_type,
         aggregate_type, aggregate_id, aggregate_version, request_id,
         topics_json, data_json, occurred_at, published_at
       ) VALUES (?, ?, 1001, 1, 'pos.order.created', 'ORDER', 'ord-1', 1, 'req-1', '[]', '{}', ?, ?)`,
    )
      .bind(oldRtId, storeId, tenDaysAgo, tenDaysAgo)
      .run();

    await env.DB.prepare(
      `INSERT INTO realtime_events (
         event_id, store_id, sequence, schema_version, event_type,
         aggregate_type, aggregate_id, aggregate_version, request_id,
         topics_json, data_json, occurred_at, published_at
       ) VALUES (?, ?, 1002, 1, 'pos.order.created', 'ORDER', 'ord-2', 1, 'req-2', '[]', '{}', ?, ?)`,
    )
      .bind(newRtId, storeId, twoDaysAgo, twoDaysAgo)
      .run();

    // 4. Auth sessions: 1 revoked old (10 days), 1 active
    const oldSessionId = `sess-old-${Math.random().toString(36).slice(2, 8)}`;
    const newSessionId = `sess-new-${Math.random().toString(36).slice(2, 8)}`;

    await env.DB.prepare(
      `INSERT INTO auth_sessions (
         id, token_hash, user_id, store_id, session_kind, status,
         credential_version, expires_at, idle_expires_at, last_seen_at, created_at, revoked_at
       ) VALUES (?, ?, ?, ?, 'OWNER', 'REVOKED', 1, ?, ?, ?, ?, ?)`,
    )
      .bind(
        oldSessionId,
        `hash-${Math.random()}`,
        userId,
        storeId,
        tenDaysAgo,
        tenDaysAgo,
        tenDaysAgo,
        tenDaysAgo,
        tenDaysAgo,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO auth_sessions (
         id, token_hash, user_id, store_id, session_kind, status,
         credential_version, expires_at, idle_expires_at, last_seen_at, created_at
       ) VALUES (?, ?, ?, ?, 'OWNER', 'ACTIVE', 1, ?, ?, ?, ?)`,
    )
      .bind(newSessionId, `hash-${Math.random()}`, userId, storeId, inTwoDays, inTwoDays, now, now)
      .run();

    // 5. Login attempts: 1 old, 1 fresh
    const oldAttemptKey = `attempt-old-${Math.random().toString(36).slice(2, 8)}`;
    const newAttemptKey = `attempt-new-${Math.random().toString(36).slice(2, 8)}`;

    await env.DB.prepare(
      `INSERT INTO login_attempts (scope, subject_key, failure_count, window_started_at, updated_at)
       VALUES ('EMPLOYEE_PIN', ?, 1, ?, ?)`,
    )
      .bind(oldAttemptKey, tenDaysAgo, tenDaysAgo)
      .run();

    await env.DB.prepare(
      `INSERT INTO login_attempts (scope, subject_key, failure_count, window_started_at, updated_at)
       VALUES ('EMPLOYEE_PIN', ?, 1, ?, ?)`,
    )
      .bind(newAttemptKey, now, now)
      .run();

    // Execute 7-day retention cleanup
    const service = new MaintenanceService(env);
    const result = await service.runRetentionCleanup(7);

    expect(result.retentionDays).toBe(7);
    expect(result.totalDeleted).toBeGreaterThanOrEqual(5);
    expect(result.tables['audit_logs']).toBeGreaterThanOrEqual(1);
    expect(result.tables['staff_notification_events']).toBeGreaterThanOrEqual(1);
    expect(result.tables['realtime_events']).toBeGreaterThanOrEqual(1);
    expect(result.tables['auth_sessions']).toBeGreaterThanOrEqual(1);
    expect(result.tables['login_attempts']).toBeGreaterThanOrEqual(1);

    // Verify Old rows are DELETED
    const oldAudit = await env.DB.prepare('SELECT id FROM audit_logs WHERE id = ?')
      .bind(oldAuditId)
      .first();
    expect(oldAudit).toBeNull();

    const oldNotif = await env.DB.prepare('SELECT id FROM staff_notification_events WHERE id = ?')
      .bind(oldNotifId)
      .first();
    expect(oldNotif).toBeNull();

    const oldRt = await env.DB.prepare('SELECT event_id FROM realtime_events WHERE event_id = ?')
      .bind(oldRtId)
      .first();
    expect(oldRt).toBeNull();

    const oldSess = await env.DB.prepare('SELECT id FROM auth_sessions WHERE id = ?')
      .bind(oldSessionId)
      .first();
    expect(oldSess).toBeNull();

    const oldAttempt = await env.DB.prepare(
      'SELECT subject_key FROM login_attempts WHERE subject_key = ?',
    )
      .bind(oldAttemptKey)
      .first();
    expect(oldAttempt).toBeNull();

    // Verify New rows are PRESERVED
    const newAudit = await env.DB.prepare('SELECT id FROM audit_logs WHERE id = ?')
      .bind(newAuditId)
      .first();
    expect(newAudit).not.toBeNull();

    const newNotif = await env.DB.prepare('SELECT id FROM staff_notification_events WHERE id = ?')
      .bind(newNotifId)
      .first();
    expect(newNotif).not.toBeNull();

    const newRt = await env.DB.prepare('SELECT event_id FROM realtime_events WHERE event_id = ?')
      .bind(newRtId)
      .first();
    expect(newRt).not.toBeNull();

    const newSess = await env.DB.prepare('SELECT id FROM auth_sessions WHERE id = ?')
      .bind(newSessionId)
      .first();
    expect(newSess).not.toBeNull();

    const newAttempt = await env.DB.prepare(
      'SELECT subject_key FROM login_attempts WHERE subject_key = ?',
    )
      .bind(newAttemptKey)
      .first();
    expect(newAttempt).not.toBeNull();
  });
});
