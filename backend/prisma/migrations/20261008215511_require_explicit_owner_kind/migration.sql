-- Abort when rows still use the retired 'legacy' owner kind: they have no reachable owner, so they must be resolved by hand first.
DO $$
DECLARE
  legacy_rows bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM "boards" WHERE "owner_kind" = 'legacy') +
    (SELECT count(*) FROM "notes" WHERE "owner_kind" = 'legacy')
  INTO legacy_rows;

  IF legacy_rows > 0 THEN
    RAISE EXCEPTION 'Migration aborted: % rows with owner_kind = ''legacy'' must be resolved first', legacy_rows;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "boards" ALTER COLUMN "owner_kind" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notes" ALTER COLUMN "owner_kind" DROP DEFAULT;
