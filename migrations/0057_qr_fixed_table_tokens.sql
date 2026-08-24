-- Add public_token column to table_qr_codes to store raw token for GET retrieval.
-- QR token is an opaque table identifier, NOT a credential.
-- Authority remains in: guest session, time session, order status, location verification.

ALTER TABLE table_qr_codes ADD COLUMN public_token TEXT;

-- Unique index on public_token (only for non-NULL values for backward compat)
CREATE UNIQUE INDEX uq_table_qr_codes_public_token
  ON table_qr_codes(public_token) WHERE public_token IS NOT NULL;
