CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE boards
ADD COLUMN IF NOT EXISTS share_token_hash TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'boards'
      AND column_name = 'share_token'
  ) THEN
    UPDATE boards
    SET share_token_hash = encode(digest(share_token, 'sha256'), 'hex')
    WHERE share_token IS NOT NULL
      AND share_token_hash IS NULL;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_share_token_hash_unique
ON boards (share_token_hash)
WHERE share_token_hash IS NOT NULL;

ALTER TABLE boards
DROP COLUMN IF EXISTS share_token;
