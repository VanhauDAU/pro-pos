import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { MaintenanceService } from '@server/services/maintenance-service';
import { RETENTION_COMMAND_TABLES } from '@server/repositories/maintenance-repository';

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
    const referencedSessionId = `sess-ref-${Math.random().toString(36).slice(2, 8)}`;
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
         credential_version, expires_at, idle_expires_at, last_seen_at, created_at, revoked_at
       ) VALUES (?, ?, ?, ?, 'OWNER', 'REVOKED', 1, ?, ?, ?, ?, ?)`,
    )
      .bind(
        referencedSessionId,
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
      `INSERT INTO audit_logs
       (id, store_id, actor_user_id, actor_session_id, action, entity_type,
        entity_id, request_id, created_at)
       VALUES (?, ?, ?, ?, 'USER_LOGIN', 'USER', ?, 'retained-session-audit', ?)`,
    )
      .bind(crypto.randomUUID(), storeId, userId, referencedSessionId, userId, twoDaysAgo)
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

    // 6. Area, Table, Product, Orders, Guest Orders, and Service Requests
    const areaId = `area-${Math.random().toString(36).slice(2, 8)}`;
    const tableId1 = `tbl-1-${Math.random().toString(36).slice(2, 8)}`;
    const tableId2 = `tbl-2-${Math.random().toString(36).slice(2, 8)}`;
    const prodId = `prod-${Math.random().toString(36).slice(2, 8)}`;
    const varId = `var-${Math.random().toString(36).slice(2, 8)}`;
    const qrCodeId = `qr-${Math.random().toString(36).slice(2, 8)}`;
    const session1Id = `gsess-1-${Math.random().toString(36).slice(2, 8)}`;
    const session2Id = `gsess-2-${Math.random().toString(36).slice(2, 8)}`;
    const referencedGuestSessionId = `gsess-ref-${Math.random().toString(36).slice(2, 8)}`;
    const paidOrderId = `ord-paid-${Math.random().toString(36).slice(2, 8)}`;
    const openOrderId = `ord-open-${Math.random().toString(36).slice(2, 8)}`;
    const timeSess1Id = `tsess-1-${Math.random().toString(36).slice(2, 8)}`;
    const timeSess2Id = `tsess-2-${Math.random().toString(36).slice(2, 8)}`;
    const paidGuestReqId = `greq-paid-${Math.random().toString(36).slice(2, 8)}`;
    const freshPaidGuestReqId = `greq-paid-fresh-${Math.random().toString(36).slice(2, 8)}`;
    const openGuestReqId = `greq-open-${Math.random().toString(36).slice(2, 8)}`;
    const paidServiceReqId = `sreq-paid-${Math.random().toString(36).slice(2, 8)}`;
    const freshPaidServiceReqId = `sreq-paid-fresh-${Math.random().toString(36).slice(2, 8)}`;
    const openServiceReqId = `sreq-open-${Math.random().toString(36).slice(2, 8)}`;

    const timeProdId = `time-prod-${Math.random().toString(36).slice(2, 8)}`;

    await env.DB.prepare(
      `INSERT INTO areas (id, store_id, name, status, created_at, updated_at) VALUES (?, ?, 'Area 1', 'ACTIVE', ?, ?)`,
    )
      .bind(areaId, storeId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO products (id, store_id, name, product_type, status, created_at, updated_at) VALUES (?, ?, 'Prod 1', 'QUANTITY', 'ACTIVE', ?, ?)`,
    )
      .bind(prodId, storeId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO products (id, store_id, name, product_type, status, created_at, updated_at) VALUES (?, ?, 'Time Prod', 'TIME', 'ACTIVE', ?, ?)`,
    )
      .bind(timeProdId, storeId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO product_variants (id, store_id, product_id, display_code, name, sale_price, cost_price, prompt_price, status, created_at, updated_at)
       VALUES (?, ?, ?, 'VAR-1', 'Default', 50000, 20000, 0, 'ACTIVE', ?, ?)`,
    )
      .bind(varId, storeId, prodId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO service_tables (id, store_id, area_id, time_product_id, name, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Bàn 1', 'AVAILABLE', 1, ?, ?)`,
    )
      .bind(tableId1, storeId, areaId, timeProdId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO service_tables (id, store_id, area_id, time_product_id, name, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Bàn 2', 'AVAILABLE', 1, ?, ?)`,
    )
      .bind(tableId2, storeId, areaId, timeProdId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO table_qr_codes (id, store_id, table_id, token_hash, version, enabled, created_by, created_at, rotated_at)
       VALUES (?, ?, ?, 'hash1', 1, 1, ?, ?, ?)`,
    )
      .bind(qrCodeId, storeId, tableId1, userId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO orders (id, store_id, table_id, status, version, opened_by, opened_at, created_at, updated_at)
       VALUES (?, ?, ?, 'PAID', 1, ?, ?, ?, ?)`,
    )
      .bind(paidOrderId, storeId, tableId1, userId, twoDaysAgo, twoDaysAgo, twoDaysAgo)
      .run();

    await env.DB.prepare(
      `INSERT INTO orders (id, store_id, table_id, status, version, opened_by, opened_at, created_at, updated_at)
       VALUES (?, ?, ?, 'OPEN', 1, ?, ?, ?, ?)`,
    )
      .bind(openOrderId, storeId, tableId2, userId, twoDaysAgo, twoDaysAgo, twoDaysAgo)
      .run();

    await env.DB.prepare(
      `INSERT INTO time_sessions (id, store_id, order_id, table_id, time_product_id, status, started_at, paused_seconds, pricing_snapshot_json, pricing_version, opened_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, 0, '{}', 1, ?, ?)`,
    )
      .bind(timeSess1Id, storeId, paidOrderId, tableId1, timeProdId, twoDaysAgo, userId, twoDaysAgo)
      .run();

    await env.DB.prepare(
      `INSERT INTO time_sessions (id, store_id, order_id, table_id, time_product_id, status, started_at, paused_seconds, pricing_snapshot_json, pricing_version, opened_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, 0, '{}', 1, ?, ?)`,
    )
      .bind(timeSess2Id, storeId, openOrderId, tableId2, timeProdId, twoDaysAgo, userId, twoDaysAgo)
      .run();

    await env.DB.prepare(
      `INSERT INTO guest_order_sessions (id, secret_hash, store_id, table_id, time_session_id, qr_code_id, status, created_at, last_seen_at, expires_at)
       VALUES (?, 'sec-1', ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    )
      .bind(session1Id, storeId, tableId1, timeSess1Id, qrCodeId, twoDaysAgo, twoDaysAgo, inTwoDays)
      .run();

    await env.DB.prepare(
      `INSERT INTO guest_order_sessions (id, secret_hash, store_id, table_id, time_session_id, qr_code_id, status, created_at, last_seen_at, expires_at)
       VALUES (?, 'sec-2', ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    )
      .bind(session2Id, storeId, tableId2, timeSess2Id, qrCodeId, twoDaysAgo, twoDaysAgo, inTwoDays)
      .run();

    await env.DB.prepare(
      `INSERT INTO guest_order_sessions (id, secret_hash, store_id, table_id, time_session_id, qr_code_id, status, created_at, last_seen_at, expires_at)
       VALUES (?, 'sec-ref', ?, ?, ?, ?, 'EXPIRED', ?, ?, ?)`,
    )
      .bind(
        referencedGuestSessionId,
        storeId,
        tableId2,
        timeSess2Id,
        qrCodeId,
        tenDaysAgo,
        tenDaysAgo,
        tenDaysAgo,
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO guest_order_requests
       (id, store_id, guest_session_id, table_id, time_session_id, order_id,
        status, client_request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 'client-retained-session', ?)`,
    )
      .bind(
        crypto.randomUUID(),
        storeId,
        referencedGuestSessionId,
        tableId2,
        timeSess2Id,
        openOrderId,
        twoDaysAgo,
      )
      .run();

    // Guest order request on PAID order (ACCEPTED 10 days ago -> must be cleaned up)
    await env.DB.prepare(
      `INSERT INTO guest_order_requests (id, store_id, guest_session_id, table_id, time_session_id, order_id, status, client_request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ACCEPTED', 'client-1', ?)`,
    )
      .bind(paidGuestReqId, storeId, session1Id, tableId1, timeSess1Id, paidOrderId, tenDaysAgo)
      .run();

    await env.DB.prepare(
      `INSERT INTO guest_order_request_items (id, store_id, request_id, product_id, variant_id, product_name_snapshot, unit_price_snapshot, quantity_milli, gross_line_total, created_at)
       VALUES ('gri-1', ?, ?, ?, ?, 'Prod 1', 50000, 1000, 50000, ?)`,
    )
      .bind(storeId, paidGuestReqId, prodId, varId, tenDaysAgo)
      .run();

    // A recently accepted request is retained for the full 7-day window, even if its order closed.
    await env.DB.prepare(
      `INSERT INTO guest_order_requests (id, store_id, guest_session_id, table_id, time_session_id, order_id, status, client_request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ACCEPTED', 'client-fresh-paid', ?)`,
    )
      .bind(
        freshPaidGuestReqId,
        storeId,
        session1Id,
        tableId1,
        timeSess1Id,
        paidOrderId,
        twoDaysAgo,
      )
      .run();

    // Guest order request on OPEN order (ACCEPTED 2 days ago -> must be PRESERVED)
    await env.DB.prepare(
      `INSERT INTO guest_order_requests (id, store_id, guest_session_id, table_id, time_session_id, order_id, status, client_request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ACCEPTED', 'client-2', ?)`,
    )
      .bind(openGuestReqId, storeId, session2Id, tableId2, timeSess2Id, openOrderId, twoDaysAgo)
      .run();

    await env.DB.prepare(
      `INSERT INTO guest_order_request_items (id, store_id, request_id, product_id, variant_id, product_name_snapshot, unit_price_snapshot, quantity_milli, gross_line_total, created_at)
       VALUES ('gri-2', ?, ?, ?, ?, 'Prod 1', 50000, 1000, 50000, ?)`,
    )
      .bind(storeId, openGuestReqId, prodId, varId, twoDaysAgo)
      .run();

    // Service request on PAID order (COMPLETED 10 days ago -> must be cleaned up)
    await env.DB.prepare(
      `INSERT INTO service_requests (id, store_id, table_id, time_session_id, order_id, guest_session_id, type, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'CHECKOUT_REQUEST', 'COMPLETED', ?)`,
    )
      .bind(paidServiceReqId, storeId, tableId1, timeSess1Id, paidOrderId, session1Id, tenDaysAgo)
      .run();

    await env.DB.prepare(
      `INSERT INTO service_requests (id, store_id, table_id, time_session_id, order_id, guest_session_id, type, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'CALL_STAFF', 'COMPLETED', ?)`,
    )
      .bind(
        freshPaidServiceReqId,
        storeId,
        tableId1,
        timeSess1Id,
        paidOrderId,
        session1Id,
        twoDaysAgo,
      )
      .run();

    // Service request on OPEN order (OPEN 2 days ago -> must be PRESERVED)
    await env.DB.prepare(
      `INSERT INTO service_requests (id, store_id, table_id, time_session_id, order_id, guest_session_id, type, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'CALL_STAFF', 'OPEN', ?)`,
    )
      .bind(openServiceReqId, storeId, tableId2, timeSess2Id, openOrderId, session2Id, twoDaysAgo)
      .run();

    const cleanupIds = {
      oldSave: crypto.randomUUID(),
      freshSave: crypto.randomUUID(),
      oldRealtimeBatch: crypto.randomUUID(),
      freshRealtimeBatch: crypto.randomUUID(),
      oldImport: crypto.randomUUID(),
      freshImport: crypto.randomUUID(),
      oldSnapshot: crypto.randomUUID(),
      freshSnapshot: crypto.randomUUID(),
      activeSnapshot: crypto.randomUUID(),
      oldTableOpen: crypto.randomUUID(),
      freshTableOpen: crypto.randomUUID(),
      oldCallBatch: crypto.randomUUID(),
      activeCallBatch: crypto.randomUUID(),
      oldTakeawayCommand: crypto.randomUUID(),
      freshTakeawayCommand: crypto.randomUUID(),
      oldTakeawayOrder: crypto.randomUUID(),
      freshTakeawayOrder: crypto.randomUUID(),
    };
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO pos_save_commands
           (id, store_id, order_id, payload_hash, response_json, created_at, completed_at)
           VALUES (?, ?, ?, 'old-hash', '{}', ?, ?)`,
      ).bind(cleanupIds.oldSave, storeId, paidOrderId, tenDaysAgo, tenDaysAgo),
      env.DB.prepare(
        `INSERT INTO pos_save_commands
           (id, store_id, order_id, payload_hash, response_json, created_at, completed_at)
           VALUES (?, ?, ?, 'fresh-hash', '{}', ?, ?)`,
      ).bind(cleanupIds.freshSave, storeId, openOrderId, twoDaysAgo, twoDaysAgo),
      env.DB.prepare(
        `INSERT INTO realtime_batch_contexts (store_id, command_id, order_id, created_at)
           VALUES (?, ?, ?, ?)`,
      ).bind(storeId, cleanupIds.oldRealtimeBatch, paidOrderId, tenDaysAgo),
      env.DB.prepare(
        `INSERT INTO realtime_batch_contexts (store_id, command_id, order_id, created_at)
           VALUES (?, ?, ?, ?)`,
      ).bind(storeId, cleanupIds.freshRealtimeBatch, openOrderId, twoDaysAgo),
      env.DB.prepare(
        `INSERT INTO catalog_import_commands
           (id, store_id, idempotency_key, payload_hash, result_json, created_at)
           VALUES (?, ?, ?, 'old-import-hash', '{}', ?)`,
      ).bind(cleanupIds.oldImport, storeId, cleanupIds.oldImport, tenDaysAgo),
      env.DB.prepare(
        `INSERT INTO catalog_import_commands
           (id, store_id, idempotency_key, payload_hash, result_json, created_at)
           VALUES (?, ?, ?, 'fresh-import-hash', '{}', ?)`,
      ).bind(cleanupIds.freshImport, storeId, cleanupIds.freshImport, twoDaysAgo),
      env.DB.prepare(
        `INSERT INTO payment_snapshots
           (id, store_id, order_id, order_type, order_version, command_id, quote_json,
            status, created_at, consumed_at)
           VALUES (?, ?, ?, 'DINE_IN', 1, ?, '{}', 'CONSUMED', ?, ?)`,
      ).bind(
        cleanupIds.oldSnapshot,
        storeId,
        paidOrderId,
        cleanupIds.oldSnapshot,
        tenDaysAgo,
        tenDaysAgo,
      ),
      env.DB.prepare(
        `INSERT INTO payment_snapshots
           (id, store_id, order_id, order_type, order_version, command_id, quote_json,
            status, created_at, consumed_at)
           VALUES (?, ?, ?, 'DINE_IN', 1, ?, '{}', 'CONSUMED', ?, ?)`,
      ).bind(
        cleanupIds.freshSnapshot,
        storeId,
        paidOrderId,
        cleanupIds.freshSnapshot,
        twoDaysAgo,
        twoDaysAgo,
      ),
      env.DB.prepare(
        `INSERT INTO payment_snapshots
           (id, store_id, order_id, order_type, order_version, command_id, quote_json,
            status, created_at)
           VALUES (?, ?, ?, 'DINE_IN', 1, ?, '{}', 'ACTIVE', ?)`,
      ).bind(
        cleanupIds.activeSnapshot,
        storeId,
        openOrderId,
        cleanupIds.activeSnapshot,
        tenDaysAgo,
      ),
      env.DB.prepare(
        `INSERT INTO table_open_requests
           (id, store_id, table_id, qr_code_id, status, created_at, handled_at, handled_by)
           VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`,
      ).bind(cleanupIds.oldTableOpen, storeId, tableId1, qrCodeId, tenDaysAgo, tenDaysAgo, userId),
      env.DB.prepare(
        `INSERT INTO table_open_requests
           (id, store_id, table_id, qr_code_id, status, created_at, handled_at, handled_by)
           VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`,
      ).bind(
        cleanupIds.freshTableOpen,
        storeId,
        tableId1,
        qrCodeId,
        twoDaysAgo,
        twoDaysAgo,
        userId,
      ),
    ]);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO order_call_batches
           (id, store_id, order_id, order_type, sequence_no, actor_user_id, request_id, created_at)
           VALUES (?, ?, ?, 'DINE_IN', 1, ?, ?, ?)`,
      ).bind(
        cleanupIds.oldCallBatch,
        storeId,
        paidOrderId,
        userId,
        `request-${cleanupIds.oldCallBatch}`,
        tenDaysAgo,
      ),
      env.DB.prepare(
        `INSERT INTO order_call_batches
           (id, store_id, order_id, order_type, sequence_no, actor_user_id, request_id, created_at)
           VALUES (?, ?, ?, 'DINE_IN', 1, ?, ?, ?)`,
      ).bind(
        cleanupIds.activeCallBatch,
        storeId,
        openOrderId,
        userId,
        `request-${cleanupIds.activeCallBatch}`,
        tenDaysAgo,
      ),
    ]);
    await env.DB.batch(
      [cleanupIds.oldCallBatch, cleanupIds.activeCallBatch].map((batchId) =>
        env.DB.prepare(
          `INSERT INTO order_call_batch_entries
             (id, store_id, batch_id, order_id, change_type, product_id, product_type,
              product_name_snapshot, unit_price_snapshot, before_quantity_milli,
              delta_quantity_milli, after_quantity_milli, created_at)
             VALUES (?, ?, ?, ?, 'ADD', ?, 'QUANTITY', 'Prod 1', 50000, 0, 1000, 1000, ?)`,
        ).bind(
          crypto.randomUUID(),
          storeId,
          batchId,
          batchId === cleanupIds.oldCallBatch ? paidOrderId : openOrderId,
          prodId,
          tenDaysAgo,
        ),
      ),
    );
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO create_takeaway_order_commands
           (id, store_id, order_id, display_code, note, actor_user_id, request_id, issued_at, business_day)
           VALUES (?, ?, ?, 'CLN-OLD', NULL, ?, ?, ?, '20260801')`,
      ).bind(
        cleanupIds.oldTakeawayCommand,
        storeId,
        cleanupIds.oldTakeawayOrder,
        userId,
        `request-${cleanupIds.oldTakeawayCommand}`,
        tenDaysAgo,
      ),
      env.DB.prepare(
        `INSERT INTO create_takeaway_order_commands
           (id, store_id, order_id, display_code, note, actor_user_id, request_id, issued_at, business_day)
           VALUES (?, ?, ?, 'CLN-NEW', NULL, ?, ?, ?, '20260820')`,
      ).bind(
        cleanupIds.freshTakeawayCommand,
        storeId,
        cleanupIds.freshTakeawayOrder,
        userId,
        `request-${cleanupIds.freshTakeawayCommand}`,
        twoDaysAgo,
      ),
    ]);

    // Execute 7-day retention cleanup
    const service = new MaintenanceService(env);
    const result = await service.runRetentionCleanup(7);

    expect(result.retentionDays).toBe(7);
    expect(result.totalDeleted).toBeGreaterThanOrEqual(7);
    expect(result.tables['audit_logs']).toBeGreaterThanOrEqual(1);
    expect(result.tables['staff_notification_events']).toBeGreaterThanOrEqual(1);
    expect(result.tables['realtime_events']).toBeGreaterThanOrEqual(1);
    expect(result.tables['auth_sessions']).toBeGreaterThanOrEqual(1);
    expect(result.tables['login_attempts']).toBeGreaterThanOrEqual(1);
    expect(result.tables['guest_order_requests']).toBeGreaterThanOrEqual(1);
    expect(result.tables['service_requests']).toBeGreaterThanOrEqual(1);
    expect(result.tables['table_open_requests']).toBeGreaterThanOrEqual(1);
    expect(result.tables['payment_snapshots']).toBeGreaterThanOrEqual(1);
    expect(result.tables['pos_save_commands']).toBeGreaterThanOrEqual(1);
    expect(result.tables['realtime_batch_contexts']).toBeGreaterThanOrEqual(1);
    expect(result.tables['catalog_import_commands']).toBeGreaterThanOrEqual(1);
    expect(result.tables['order_call_batches']).toBeGreaterThanOrEqual(1);
    expect(result.tables['order_call_batch_entries']).toBeGreaterThanOrEqual(1);
    expect(result.tables['create_takeaway_order_commands']).toBeGreaterThanOrEqual(1);
    for (const commandTable of RETENTION_COMMAND_TABLES) {
      expect(result.tables).toHaveProperty(commandTable);
    }

    // Verify Old / Completed order requests are DELETED
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

    const paidGuestReq = await env.DB.prepare('SELECT id FROM guest_order_requests WHERE id = ?')
      .bind(paidGuestReqId)
      .first();
    expect(paidGuestReq).toBeNull();

    const paidServiceReq = await env.DB.prepare('SELECT id FROM service_requests WHERE id = ?')
      .bind(paidServiceReqId)
      .first();
    expect(paidServiceReq).toBeNull();

    await Promise.all(
      (
        [
          ['pos_save_commands', cleanupIds.oldSave],
          ['catalog_import_commands', cleanupIds.oldImport],
          ['payment_snapshots', cleanupIds.oldSnapshot],
          ['table_open_requests', cleanupIds.oldTableOpen],
          ['order_call_batches', cleanupIds.oldCallBatch],
          ['create_takeaway_order_commands', cleanupIds.oldTakeawayCommand],
        ] as const
      ).map(async ([table, id]) => {
        const deleted = await env.DB.prepare(`SELECT 1 AS found FROM ${table} WHERE id = ?`)
          .bind(id)
          .first();
        expect(deleted).toBeNull();
      }),
    );
    expect(
      await env.DB.prepare(
        'SELECT 1 AS found FROM realtime_batch_contexts WHERE store_id = ? AND command_id = ?',
      )
        .bind(storeId, cleanupIds.oldRealtimeBatch)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare('SELECT id FROM takeaway_orders WHERE id = ?')
        .bind(cleanupIds.oldTakeawayOrder)
        .first(),
    ).not.toBeNull();

    // Verify New / Active order requests are PRESERVED
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

    const referencedSession = await env.DB.prepare('SELECT id FROM auth_sessions WHERE id = ?')
      .bind(referencedSessionId)
      .first();
    expect(referencedSession).not.toBeNull();

    const referencedGuestSession = await env.DB.prepare(
      'SELECT id FROM guest_order_sessions WHERE id = ?',
    )
      .bind(referencedGuestSessionId)
      .first();
    expect(referencedGuestSession).not.toBeNull();

    const newAttempt = await env.DB.prepare(
      'SELECT subject_key FROM login_attempts WHERE subject_key = ?',
    )
      .bind(newAttemptKey)
      .first();
    expect(newAttempt).not.toBeNull();

    const openGuestReq = await env.DB.prepare('SELECT id FROM guest_order_requests WHERE id = ?')
      .bind(openGuestReqId)
      .first();
    expect(openGuestReq).not.toBeNull();

    const openServiceReq = await env.DB.prepare('SELECT id FROM service_requests WHERE id = ?')
      .bind(openServiceReqId)
      .first();
    expect(openServiceReq).not.toBeNull();

    const freshPaidGuestReq = await env.DB.prepare(
      'SELECT id FROM guest_order_requests WHERE id = ?',
    )
      .bind(freshPaidGuestReqId)
      .first();
    expect(freshPaidGuestReq).not.toBeNull();

    const freshPaidServiceReq = await env.DB.prepare('SELECT id FROM service_requests WHERE id = ?')
      .bind(freshPaidServiceReqId)
      .first();
    expect(freshPaidServiceReq).not.toBeNull();

    await Promise.all(
      (
        [
          ['pos_save_commands', cleanupIds.freshSave],
          ['catalog_import_commands', cleanupIds.freshImport],
          ['payment_snapshots', cleanupIds.freshSnapshot],
          ['payment_snapshots', cleanupIds.activeSnapshot],
          ['table_open_requests', cleanupIds.freshTableOpen],
          ['order_call_batches', cleanupIds.activeCallBatch],
          ['create_takeaway_order_commands', cleanupIds.freshTakeawayCommand],
        ] as const
      ).map(async ([table, id]) => {
        const retained = await env.DB.prepare(`SELECT 1 AS found FROM ${table} WHERE id = ?`)
          .bind(id)
          .first();
        expect(retained).not.toBeNull();
      }),
    );
    expect(
      await env.DB.prepare(
        'SELECT 1 AS found FROM realtime_batch_contexts WHERE store_id = ? AND command_id = ?',
      )
        .bind(storeId, cleanupIds.freshRealtimeBatch)
        .first(),
    ).not.toBeNull();
  });
});
