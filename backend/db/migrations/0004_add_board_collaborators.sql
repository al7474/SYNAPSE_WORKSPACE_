CREATE TABLE IF NOT EXISTS board_collaborators (
  id BIGSERIAL PRIMARY KEY,
  board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (board_id, email)
);

CREATE INDEX IF NOT EXISTS idx_board_collaborators_email
ON board_collaborators (email);

CREATE INDEX IF NOT EXISTS idx_board_collaborators_board
ON board_collaborators (board_id, permission);
