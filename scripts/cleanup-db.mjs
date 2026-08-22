import { execSync } from 'node:child_process';

const environment = process.argv[2] || 'local';
const retentionDays = parseInt(process.argv[3] || '7', 10);

if (!['local', 'staging', 'production'].includes(environment)) {
  console.error('Usage: node scripts/cleanup-db.mjs <local|staging|production> [retentionDays=7]');
  process.exit(1);
}

const nowMs = Date.now();
const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;

console.log(`🧹 Running ${retentionDays}-day retention database cleanup for environment: "${environment}"...`);
console.log(`Cutoff timestamp: ${cutoffMs} (${new Date(cutoffMs).toISOString()})`);

const queries = [
  `DELETE FROM audit_logs WHERE created_at < ${cutoffMs};`,
  `DELETE FROM staff_notification_events WHERE expires_at <= ${nowMs} OR created_at < ${cutoffMs};`,
  `DELETE FROM realtime_events WHERE published_at IS NOT NULL AND (published_at < ${cutoffMs} OR occurred_at < ${cutoffMs});`,
  `DELETE FROM realtime_event_requests WHERE occurred_at < ${cutoffMs};`,
  `DELETE FROM auth_sessions WHERE (status IN ('EXPIRED', 'REVOKED') OR expires_at < ${nowMs}) AND last_seen_at < ${cutoffMs};`,
  `DELETE FROM login_attempts WHERE updated_at < ${cutoffMs} AND (locked_until IS NULL OR locked_until < ${nowMs});`,
  `DELETE FROM activation_grants WHERE status IN ('CONSUMED', 'EXPIRED', 'CANCELLED') AND (created_at < ${cutoffMs} OR expires_at < ${cutoffMs});`,
  `DELETE FROM access_auth_requests WHERE expires_at < ${nowMs} OR created_at < ${cutoffMs};`,
  `DELETE FROM service_requests WHERE status IN ('COMPLETED', 'CANCELLED') AND created_at < ${cutoffMs};`,
  `DELETE FROM guest_order_request_items WHERE request_id IN (SELECT id FROM guest_order_requests WHERE status IN ('ACCEPTED', 'REJECTED', 'CANCELLED') AND created_at < ${cutoffMs});`,
  `DELETE FROM guest_order_requests WHERE status IN ('ACCEPTED', 'REJECTED', 'CANCELLED') AND created_at < ${cutoffMs};`,
  `DELETE FROM guest_order_sessions WHERE (status IN ('EXPIRED', 'REVOKED') OR expires_at < ${nowMs}) AND expires_at < ${cutoffMs};`,
  `DELETE FROM create_takeaway_order_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM add_takeaway_item_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM update_order_item_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM remove_order_item_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM update_order_note_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM update_order_guest_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM takeaway_checkout_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM cancel_takeaway_order_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM create_time_session_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM remove_time_session_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM update_time_range_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM stop_time_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM resume_checkout_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM create_guest_order_request_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM accept_guest_order_request_commands WHERE issued_at < ${cutoffMs};`,
  `DELETE FROM reject_guest_order_request_commands WHERE issued_at < ${cutoffMs};`,
];

const sql = queries.join(' ');

let cmd = `npx wrangler d1 execute DB --command="${sql.replace(/"/g, '\\"')}"`;
if (environment === 'local') {
  cmd += ' --local';
} else {
  cmd += ` --remote --env ${environment}`;
}

try {
  execSync(cmd, { stdio: 'inherit' });
  console.log(`✅ Database ${retentionDays}-day retention cleanup finished successfully!`);
} catch (err) {
  console.error('❌ Failed to execute cleanup:', err.message);
  process.exit(1);
}
