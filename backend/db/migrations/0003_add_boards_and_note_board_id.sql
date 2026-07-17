CREATE TABLE IF NOT EXISTS boards (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  share_token TEXT UNIQUE,
  share_permission TEXT NOT NULL DEFAULT 'view' CHECK (share_permission IN ('view', 'edit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS board_id BIGINT;

INSERT INTO boards (owner_id, name)
SELECT DISTINCT owner_id, 'Imported Board'
FROM notes
WHERE owner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM boards b
    WHERE b.owner_id = notes.owner_id
      AND b.name = 'Imported Board'
  );

UPDATE notes
SET board_id = b.id
FROM boards b
WHERE notes.board_id IS NULL
  AND notes.owner_id = b.owner_id
  AND b.name = 'Imported Board';

ALTER TABLE notes
ALTER COLUMN board_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notes_board_id_fkey'
  ) THEN
    ALTER TABLE notes
    ADD CONSTRAINT notes_board_id_fkey
    FOREIGN KEY (board_id)
    REFERENCES boards(id)
    ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_boards_owner_updated_at
ON boards (owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_board_updated_at
ON notes (board_id, updated_at DESC);
