ALTER TABLE print_jobs ADD COLUMN claim_lease_expires_at INTEGER;
ALTER TABLE print_jobs ADD COLUMN claim_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE print_jobs ADD COLUMN claim_token TEXT;
ALTER TABLE print_jobs ADD COLUMN claim_protocol_version INTEGER NOT NULL DEFAULT 1;

UPDATE print_jobs
SET claim_lease_expires_at = claimed_at + 30000
WHERE status = 'CLAIMED' AND claimed_at IS NOT NULL;
