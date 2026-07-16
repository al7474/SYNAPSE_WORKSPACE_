import { DEFAULT_DATABASE_URL, DEFAULT_NOTES_TABLE } from "./lib/constants.js";
import { createConnectedClient, ensureNotesSchema, resetNotesTable } from "./lib/db.js";
import { fetchEmbedding, toPgvectorLiteral } from "./lib/openrouter.js";

async function saveNoteWithFallback(client, tableName, note, embeddingOptions = {}) {
  try {
    const embedding = await fetchEmbedding({
      input: note.content,
      ...embeddingOptions,
    });

    const inserted = await client.query(
      `
      INSERT INTO ${tableName} (title, content, embedding, embedding_pending)
      VALUES ($1, $2, $3::vector, FALSE)
      RETURNING id, title, embedding_pending, embedding IS NOT NULL AS has_embedding
      `,
      [note.title, note.content, toPgvectorLiteral(embedding)]
    );

    return { mode: "embedded", row: inserted.rows[0] };
  } catch (_error) {
    const inserted = await client.query(
      `
      INSERT INTO ${tableName} (title, content, embedding, embedding_pending)
      VALUES ($1, $2, NULL, TRUE)
      RETURNING id, title, embedding_pending, embedding IS NOT NULL AS has_embedding
      `,
      [note.title, note.content]
    );

    return { mode: "fallback", row: inserted.rows[0] };
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const tableName = process.env.SMOKE_NOTES_TABLE || DEFAULT_NOTES_TABLE;

  const client = await createConnectedClient(databaseUrl);

  try {
    await ensureNotesSchema(client, tableName);
    await resetNotesTable(client, tableName);

    const note = {
      title: "Fallback scenario note",
      content: "This note should still be saved when OpenRouter fails.",
    };

    const invalidKeyResult = await saveNoteWithFallback(client, tableName, note, {
      apiKey: "invalid_api_key_for_smoke_test",
      timeoutMs: 10000,
    });

    const timeoutResult = await saveNoteWithFallback(
      client,
      tableName,
      {
        title: "Timeout fallback note",
        content: "This note simulates timeout and must be marked embedding pending.",
      },
      {
        timeoutMs: 1,
      }
    );

    console.log("Invalid key result:", invalidKeyResult);
    console.log("Timeout result:", timeoutResult);

    if (invalidKeyResult.mode !== "fallback" || invalidKeyResult.row.embedding_pending !== true) {
      throw new Error("Invalid key fallback test failed.");
    }

    if (timeoutResult.mode !== "fallback" || timeoutResult.row.embedding_pending !== true) {
      throw new Error("Timeout fallback test failed.");
    }

    const countResult = await client.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE embedding_pending) AS pending FROM ${tableName}`
    );

    console.log("Saved notes summary:", countResult.rows[0]);
    console.log("Success: resilience fallback smoke test passed.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Resilience fallback smoke test failed:");
  console.error(error);
  process.exit(1);
});
