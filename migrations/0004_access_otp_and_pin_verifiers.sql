PRAGMA foreign_keys = ON;

CREATE TABLE access_identities (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider = 'CLOUDFLARE_ACCESS'),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  subject TEXT UNIQUE,
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE access_auth_requests (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (
    purpose IN ('OWNER_LOGIN', 'PLATFORM_LOGIN', 'DEVICE_ACTIVATION', 'DEVICE_REISSUE')
  ),
  target_device_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_access_auth_requests_expiry
  ON access_auth_requests(status, expires_at);

CREATE TABLE pin_verifiers (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  algorithm TEXT NOT NULL CHECK (algorithm = 'HMAC-SHA256-PEPPERED'),
  salt TEXT NOT NULL,
  digest TEXT NOT NULL,
  pepper_version INTEGER NOT NULL CHECK (pepper_version > 0),
  credential_version INTEGER NOT NULL CHECK (credential_version > 0),
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_access_identities_email
  ON access_identities(email COLLATE NOCASE);
