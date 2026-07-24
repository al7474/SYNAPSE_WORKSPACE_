CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_name_length_check CHECK (char_length(btrim(name)) >= 2)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique
ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
ON auth_sessions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
ON auth_sessions (expires_at)
WHERE revoked_at IS NULL;

ALTER TABLE boards
ADD COLUMN IF NOT EXISTS owner_kind TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE boards
ADD COLUMN IF NOT EXISTS owner_user_id BIGINT;

ALTER TABLE boards
ADD COLUMN IF NOT EXISTS owner_guest_session_id BIGINT;

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS owner_kind TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS owner_user_id BIGINT;

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS owner_guest_session_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'boards_owner_user_id_fkey'
  ) THEN
    ALTER TABLE boards
    ADD CONSTRAINT boards_owner_user_id_fkey
    FOREIGN KEY (owner_user_id)
    REFERENCES users(id)
    ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'boards_owner_guest_session_id_fkey'
  ) THEN
    ALTER TABLE boards
    ADD CONSTRAINT boards_owner_guest_session_id_fkey
    FOREIGN KEY (owner_guest_session_id)
    REFERENCES guest_sessions(id)
    ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notes_owner_user_id_fkey'
  ) THEN
    ALTER TABLE notes
    ADD CONSTRAINT notes_owner_user_id_fkey
    FOREIGN KEY (owner_user_id)
    REFERENCES users(id)
    ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notes_owner_guest_session_id_fkey'
  ) THEN
    ALTER TABLE notes
    ADD CONSTRAINT notes_owner_guest_session_id_fkey
    FOREIGN KEY (owner_guest_session_id)
    REFERENCES guest_sessions(id)
    ON DELETE CASCADE;
  END IF;
END;
$$;

UPDATE boards b
SET owner_kind = 'guest',
    owner_guest_session_id = gs.id
FROM guest_sessions gs
WHERE b.owner_id = gs.owner_id
  AND b.owner_kind = 'legacy';

UPDATE notes n
SET owner_kind = b.owner_kind,
    owner_user_id = b.owner_user_id,
    owner_guest_session_id = b.owner_guest_session_id
FROM boards b
WHERE n.board_id = b.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'boards_owner_kind_check'
  ) THEN
    ALTER TABLE boards
    ADD CONSTRAINT boards_owner_kind_check
    CHECK (owner_kind IN ('user', 'guest', 'legacy'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'boards_owner_reference_check'
  ) THEN
    ALTER TABLE boards
    ADD CONSTRAINT boards_owner_reference_check
    CHECK (
      (owner_kind = 'user' AND owner_user_id IS NOT NULL AND owner_guest_session_id IS NULL)
      OR (owner_kind = 'guest' AND owner_user_id IS NULL AND owner_guest_session_id IS NOT NULL)
      OR (owner_kind = 'legacy' AND owner_user_id IS NULL AND owner_guest_session_id IS NULL)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notes_owner_kind_check'
  ) THEN
    ALTER TABLE notes
    ADD CONSTRAINT notes_owner_kind_check
    CHECK (owner_kind IN ('user', 'guest', 'legacy'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notes_owner_reference_check'
  ) THEN
    ALTER TABLE notes
    ADD CONSTRAINT notes_owner_reference_check
    CHECK (
      (owner_kind = 'user' AND owner_user_id IS NOT NULL AND owner_guest_session_id IS NULL)
      OR (owner_kind = 'guest' AND owner_user_id IS NULL AND owner_guest_session_id IS NOT NULL)
      OR (owner_kind = 'legacy' AND owner_user_id IS NULL AND owner_guest_session_id IS NULL)
    );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_boards_owner_user_updated_at
ON boards (owner_user_id, updated_at DESC)
WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_boards_owner_guest_updated_at
ON boards (owner_guest_session_id, updated_at DESC)
WHERE owner_guest_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notes_owner_user_updated_at
ON notes (owner_user_id, updated_at DESC)
WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notes_owner_guest_updated_at
ON notes (owner_guest_session_id, updated_at DESC)
WHERE owner_guest_session_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'board_collaborators'
      AND column_name = 'email'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'board_collaborators'
      AND column_name = 'invited_email'
  ) THEN
    ALTER TABLE board_collaborators
    RENAME COLUMN email TO invited_email;
  END IF;
END;
$$;

ALTER TABLE board_collaborators
ADD COLUMN IF NOT EXISTS user_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'board_collaborators_user_id_fkey'
  ) THEN
    ALTER TABLE board_collaborators
    ADD CONSTRAINT board_collaborators_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_board_collaborators_user
ON board_collaborators (user_id, board_id)
WHERE user_id IS NOT NULL;