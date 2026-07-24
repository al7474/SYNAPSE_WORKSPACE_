CREATE TABLE IF NOT EXISTS guest_sessions (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_expiry
ON guest_sessions (expires_at)
WHERE revoked_at IS NULL;