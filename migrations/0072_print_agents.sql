-- Migration 0072: Print Agents & Pairing Sessions
CREATE TABLE IF NOT EXISTS print_agents (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  agent_secret_hash TEXT NOT NULL,
  printer_role TEXT NOT NULL DEFAULT 'receipt',
  printer_config_json TEXT,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_print_agents_store ON print_agents(store_id);

CREATE TABLE IF NOT EXISTS print_agent_pairings (
  session_id TEXT PRIMARY KEY,
  pairing_code TEXT NOT NULL UNIQUE,
  store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
  agent_id TEXT,
  agent_secret TEXT,
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'APPROVED', 'EXPIRED')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_print_agent_pairings_code ON print_agent_pairings(pairing_code, status);
