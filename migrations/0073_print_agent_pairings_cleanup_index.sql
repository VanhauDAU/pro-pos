PRAGMA foreign_keys = ON;

-- Scheduled cleanup index for expired/approved pairing sessions
CREATE INDEX IF NOT EXISTS idx_print_agent_pairings_cleanup
  ON print_agent_pairings(status, expires_at, created_at);
