CREATE TABLE IF NOT EXISTS auth_action_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_user_purpose
ON auth_action_tokens (user_id, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_expiry
ON auth_action_tokens (expires_at)
WHERE consumed_at IS NULL;