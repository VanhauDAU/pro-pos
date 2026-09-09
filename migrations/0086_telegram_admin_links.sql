PRAGMA foreign_keys = ON;

CREATE TABLE telegram_admin_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  telegram_user_id TEXT NOT NULL UNIQUE,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  telegram_chat_id TEXT,
  linked_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_telegram_admin_links_user_id ON telegram_admin_links(user_id);
CREATE INDEX idx_telegram_admin_links_tg_user ON telegram_admin_links(telegram_user_id);

CREATE TABLE telegram_link_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_telegram_link_codes_hash ON telegram_link_codes(code_hash);
CREATE INDEX idx_telegram_link_codes_user ON telegram_link_codes(user_id);
