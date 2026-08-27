import { spawnSync } from 'node:child_process';

const environment = process.argv[2] || 'local';
const retentionDays = Number.parseInt(process.argv[3] || '7', 10);

if (
  !['local', 'staging', 'production'].includes(environment) ||
  !Number.isInteger(retentionDays) ||
  retentionDays < 1 ||
  retentionDays > 365
) {
  console.error('Usage: node scripts/cleanup-db.mjs <local|staging|production> [retentionDays=7]');
  process.exit(1);
}

const nowMs = Date.now();
const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
const terminalGuestRequests = `
  SELECT id FROM guest_order_requests
  WHERE status IN ('ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED')
    AND created_at < ${cutoffMs}`;
const commandTables = [
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
];
const closedCallBatches = `
  SELECT batch.id FROM order_call_batches batch
  WHERE batch.created_at < ${cutoffMs}
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

console.log(
  `🧹 Running ${retentionDays}-day retention database cleanup for environment: "${environment}"...`,
);
console.log(`Cutoff timestamp: ${cutoffMs} (${new Date(cutoffMs).toISOString()})`);

const queries = [
  `DELETE FROM audit_logs WHERE created_at < ${cutoffMs}`,
  `DELETE FROM staff_notification_events WHERE expires_at <= ${nowMs} OR created_at < ${cutoffMs}`,
  `DELETE FROM realtime_events WHERE published_at IS NOT NULL AND (published_at < ${cutoffMs} OR occurred_at < ${cutoffMs})`,
  `DELETE FROM realtime_event_requests WHERE occurred_at < ${cutoffMs}`,
  `DELETE FROM accept_guest_order_request_commands WHERE guest_request_id IN (${terminalGuestRequests})`,
  `DELETE FROM reject_guest_order_request_commands WHERE guest_request_id IN (${terminalGuestRequests})`,
  `DELETE FROM guest_order_request_items WHERE request_id IN (${terminalGuestRequests})`,
  `DELETE FROM guest_order_requests WHERE status IN ('ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED') AND created_at < ${cutoffMs}`,
  `DELETE FROM service_requests WHERE status IN ('COMPLETED', 'CANCELLED') AND created_at < ${cutoffMs}`,
  `DELETE FROM table_open_requests WHERE status IN ('COMPLETED', 'CANCELLED') AND created_at < ${cutoffMs}`,
  ...commandTables.map((table) => `DELETE FROM ${table} WHERE issued_at < ${cutoffMs}`),
  `DELETE FROM pos_save_commands WHERE created_at < ${cutoffMs}`,
  `DELETE FROM realtime_batch_contexts WHERE created_at < ${cutoffMs}`,
  `DELETE FROM catalog_import_commands WHERE created_at < ${cutoffMs}`,
  `DELETE FROM payment_snapshots WHERE status IN ('CONSUMED', 'INVALIDATED') AND created_at < ${cutoffMs}`,
  `DELETE FROM order_call_batch_entries WHERE batch_id IN (${closedCallBatches})`,
  `DELETE FROM order_call_batches WHERE id IN (${closedCallBatches})`,
  `DELETE FROM guest_order_sessions
   WHERE (status IN ('EXPIRED', 'REVOKED') OR expires_at < ${nowMs}) AND expires_at < ${cutoffMs}
     AND NOT EXISTS (SELECT 1 FROM guest_order_requests request WHERE request.guest_session_id = guest_order_sessions.id)
     AND NOT EXISTS (SELECT 1 FROM service_requests request WHERE request.guest_session_id = guest_order_sessions.id)
     AND NOT EXISTS (SELECT 1 FROM create_guest_order_request_commands command WHERE command.guest_session_id = guest_order_sessions.id)`,
  `DELETE FROM auth_sessions
   WHERE (status IN ('EXPIRED', 'REVOKED') OR expires_at < ${nowMs}) AND last_seen_at < ${cutoffMs}
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
  `DELETE FROM login_attempts WHERE updated_at < ${cutoffMs} AND (locked_until IS NULL OR locked_until < ${nowMs})`,
  `DELETE FROM activation_grants WHERE status IN ('CONSUMED', 'EXPIRED', 'CANCELLED') AND (created_at < ${cutoffMs} OR expires_at < ${cutoffMs})`,
  `DELETE FROM access_auth_requests WHERE expires_at < ${nowMs} OR created_at < ${cutoffMs}`,
];
const args = ['wrangler', 'd1', 'execute', 'DB', '--command', `${queries.join('; ')};`];
if (environment === 'local') args.push('--local');
else args.push('--remote', '--env', environment);

const result = spawnSync('pnpm', ['exec', ...args], { stdio: 'inherit' });
if (result.error || result.status !== 0) {
  console.error('❌ Failed to execute cleanup:', result.error?.message ?? `exit ${result.status}`);
  process.exit(result.status ?? 1);
}
console.log(`✅ Database ${retentionDays}-day retention cleanup finished successfully!`);
