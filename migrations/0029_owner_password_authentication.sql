PRAGMA foreign_keys = ON;

-- Ensure indexes on users(username) and users(email) for fast lookups during login
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE);
