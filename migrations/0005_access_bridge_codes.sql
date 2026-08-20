PRAGMA foreign_keys = ON;

ALTER TABLE access_auth_requests ADD COLUMN access_email TEXT;
ALTER TABLE access_auth_requests ADD COLUMN access_subject TEXT;
ALTER TABLE access_auth_requests ADD COLUMN authorization_code_hash TEXT;
ALTER TABLE access_auth_requests ADD COLUMN authorized_at INTEGER;

CREATE UNIQUE INDEX idx_access_auth_requests_code_hash
  ON access_auth_requests(authorization_code_hash)
  WHERE authorization_code_hash IS NOT NULL;
