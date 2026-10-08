-- Notes now embed title and content together, so existing notes are queued for reindexing.
-- Only the flag changes: current embeddings stay searchable until the reindex worker replaces them,
-- and updated_at is untouched so note ordering does not change.
UPDATE "notes"
SET "embedding_pending" = TRUE
WHERE "embedding_pending" = FALSE;