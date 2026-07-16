import { DEFAULT_DATABASE_URL, DEFAULT_NOTES_TABLE } from "./lib/constants.js";
import { createConnectedClient, ensureNotesSchema, resetNotesTable } from "./lib/db.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInterval(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const tableName = process.env.SMOKE_NOTES_TABLE || DEFAULT_NOTES_TABLE;
  const durationMs = Number(process.env.SMOKE_AUTOSAVE_DURATION_MS || 70000);
  const minIntervalMs = Number(process.env.SMOKE_AUTOSAVE_MIN_INTERVAL_MS || 2000);
  const maxIntervalMs = Number(process.env.SMOKE_AUTOSAVE_MAX_INTERVAL_MS || 3000);

  const client = await createConnectedClient(databaseUrl);

  try {
    await ensureNotesSchema(client, tableName);
    await resetNotesTable(client, tableName);

    const baseTitle = "Autosave realistic note";
    const created = await client.query(
      `
      INSERT INTO ${tableName} (title, content, embedding_pending)
      VALUES ($1, $2, TRUE)
      RETURNING id
      `,
      [baseTitle, "Initial autosave content"]
    );

    const noteId = created.rows[0].id;
    const startedAt = Date.now();

    let revision = 0;
    let lastContent = "Initial autosave content";

    while (Date.now() - startedAt < durationMs) {
      const waitMs = randomInterval(minIntervalMs, maxIntervalMs);
      await sleep(waitMs);

      revision += 1;
      lastContent = `Autosave revision ${revision} at ${new Date().toISOString()}`;

      const update = await client.query(
        `
        UPDATE ${tableName}
        SET content = $1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING id
        `,
        [lastContent, noteId]
      );

      if (update.rowCount !== 1) {
        throw new Error("Autosave update affected unexpected row count.");
      }

      console.log(`Autosave tick #${revision} (${waitMs} ms)`);
    }

    const duplicateCheck = await client.query(
      `
      SELECT count(*)::int AS total
      FROM ${tableName}
      WHERE title = $1
      `,
      [baseTitle]
    );

    const finalState = await client.query(
      `
      SELECT id, title, content, created_at, updated_at
      FROM ${tableName}
      WHERE id = $1
      `,
      [noteId]
    );

    const totalRows = duplicateCheck.rows[0].total;
    const finalContent = finalState.rows[0]?.content;
    const noDuplicates = totalRows === 1;
    const noContentLoss = finalContent === lastContent;

    console.log("Autosave revisions executed:", revision);
    console.log("Duration ms:", Date.now() - startedAt);
    console.log("Duplicate check total rows:", totalRows);
    console.log("Final content matches latest revision:", noContentLoss);
    console.log("No duplicates:", noDuplicates);

    if (!noDuplicates || !noContentLoss) {
      throw new Error("Autosave validation failed: duplicates or content loss detected.");
    }

    console.log("Success: realistic autosave smoke test passed.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Realistic autosave smoke test failed:");
  console.error(error);
  process.exit(1);
});
