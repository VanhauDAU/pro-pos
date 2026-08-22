PRAGMA foreign_keys = ON;

-- Indexes for 14-day retention cleanup on audit, session, command, and log tables
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_cleanup ON auth_sessions(status, expires_at, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_updated_at ON login_attempts(updated_at);
CREATE INDEX IF NOT EXISTS idx_activation_grants_cleanup ON activation_grants(status, created_at);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_cleanup ON guest_order_sessions(status, expires_at);
