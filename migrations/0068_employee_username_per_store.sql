PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

-- Usernames are used differently by each login flow. Owner/Super Admin logins
-- resolve their own identity, while a POS employee always authenticates against
-- the store bound to the activated device. Remove the global username constraint
-- so employee usernames can be reused by another store.
CREATE TABLE users_replacement (
  id TEXT PRIMARY KEY,
  platform_role TEXT CHECK (platform_role IN ('SUPER_ADMIN') OR platform_role IS NULL),
  username TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO users_replacement (
  id, platform_role, username, display_name, email, phone, status,
  must_change_password, created_at, updated_at
)
SELECT
  id, platform_role, username, display_name, email, phone, status,
  must_change_password, created_at, updated_at
FROM users;

-- Do not rename the original table: SQLite would rewrite every dependent
-- foreign key to the temporary name. Dropping it while FKs are disabled then
-- renaming the replacement preserves the existing `REFERENCES users(...)`.
DROP TABLE users;
ALTER TABLE users_replacement RENAME TO users;

PRAGMA legacy_alter_table = OFF;
PRAGMA defer_foreign_keys = OFF;

CREATE INDEX idx_users_username ON users(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE);

CREATE TABLE store_employee_usernames (
  store_id TEXT NOT NULL REFERENCES stores(id),
  username TEXT NOT NULL COLLATE NOCASE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, username),
  UNIQUE (store_id, user_id)
);

INSERT INTO store_employee_usernames (store_id, username, user_id, created_at)
SELECT sm.store_id, u.username, sm.user_id, sm.created_at
FROM store_memberships sm
JOIN users u ON u.id = sm.user_id
JOIN roles r ON r.id = sm.role_id AND r.store_id = sm.store_id
WHERE r.code <> 'OWNER';

PRAGMA foreign_keys = ON;

