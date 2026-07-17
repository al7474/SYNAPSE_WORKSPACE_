ALTER TABLE notes
ADD COLUMN IF NOT EXISTS owner_id TEXT;

UPDATE notes
SET owner_id = COALESCE(owner_id, 'legacy')
WHERE owner_id IS NULL;

ALTER TABLE notes
ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notes_owner_updated_at
ON notes (owner_id, updated_at DESC);
