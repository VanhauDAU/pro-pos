PRAGMA foreign_keys = ON;

-- Shorten the operational notification window without touching permanent
-- financial/security audit logs. New rows already use the same 3-day policy.
UPDATE staff_notification_events
SET expires_at = created_at + (3 * 24 * 60 * 60 * 1000)
WHERE expires_at > created_at + (3 * 24 * 60 * 60 * 1000);
