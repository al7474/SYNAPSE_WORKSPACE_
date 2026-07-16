import { DEFAULT_DATABASE_URL, DEFAULT_NOTES_TABLE } from "./lib/constants.js";
import { createConnectedClient, ensureNotesSchema, resetNotesTable } from "./lib/db.js";
import { fetchEmbedding, toPgvectorLiteral } from "./lib/openrouter.js";

const notes = [
  {
    title: "Docker compose quickstart",
    content: "Use docker compose to build and run multi-container applications locally.",
  },
  {
    title: "PostgreSQL indexing tips",
    content: "B-tree and GIN indexes help query performance depending on access patterns.",
  },
  {
    title: "React state patterns",
    content: "Use reducers and memoization for predictable state updates in complex UIs.",
  },
  {
    title: "Kubernetes deployment basics",
    content: "Deployments manage replicated pods and rolling updates in Kubernetes.",
  },
  {
    title: "Node.js event loop",
    content: "The event loop coordinates async I O callbacks and timers in Node.js.",
  },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const tableName = process.env.SMOKE_NOTES_TABLE || DEFAULT_NOTES_TABLE;
  const queryText =
    process.env.SMOKE_QUERY_TEXT ||
    "How do I package my app with containers and run it with docker compose?";

  const client = await createConnectedClient(databaseUrl);

  try {
    await ensureNotesSchema(client, tableName);
    await resetNotesTable(client, tableName);

    for (const note of notes) {
      const embedding = await fetchEmbedding({ input: note.content });
      await client.query(
        `
        INSERT INTO ${tableName} (title, content, embedding, embedding_pending)
        VALUES ($1, $2, $3::vector, FALSE)
        `,
        [note.title, note.content, toPgvectorLiteral(embedding)]
      );
    }

    const queryEmbedding = await fetchEmbedding({ input: queryText });

    const result = await client.query(
      `
      SELECT
        id,
        title,
        content,
        embedding <=> $1::vector AS cosine_distance
      FROM ${tableName}
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector ASC
      LIMIT 3
      `,
      [toPgvectorLiteral(queryEmbedding)]
    );

    const top = result.rows[0];
    const topLooksCorrect =
      typeof top?.title === "string" && top.title.toLowerCase().includes("docker");

    console.log("Inserted notes:", notes.length);
    console.log("Semantic query:", queryText);
    console.log("Top 3 results:", result.rows);
    console.log("Top result relevance check (expects Docker):", topLooksCorrect);

    if (!topLooksCorrect) {
      throw new Error("Top semantic result did not match expected Docker note.");
    }

    console.log("Success: semantic search smoke test passed.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Semantic search smoke test failed:");
  console.error(error);
  process.exit(1);
});
