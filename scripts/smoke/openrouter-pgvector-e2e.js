import { createConnectedClient } from "./lib/db.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings";
const MODEL = process.env.OPENROUTER_EMBEDDING_MODEL || "nvidia/llama-nemotron-embed-vl-1b-v2:free";
const INPUT_TEXT = process.env.OPENROUTER_TEST_INPUT || "Hello Synapse Workspace";
const TABLE_NAME = process.env.SMOKE_TABLE_NAME || "embedding_smoke_test";
const DEFAULT_DATABASE_URL = "postgresql://postgres@127.0.0.1:55432/synapse_test";

function toPgvectorLiteral(vector) {
  return `[${vector.join(",")}]`;
}

async function fetchEmbedding() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY in environment.");
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: INPUT_TEXT,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`OpenRouter error ${response.status}: ${JSON.stringify(payload)}`);
  }

  const embedding = payload?.data?.[0]?.embedding;

  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error(`Invalid embedding payload: ${JSON.stringify(payload)}`);
  }

  return embedding;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const embedding = await fetchEmbedding();
  const vectorLiteral = toPgvectorLiteral(embedding);

  console.log(`Using DATABASE_URL: ${databaseUrl}`);
  console.log(`Embedding fetched. Length: ${embedding.length}`);
  console.log("First 5 values:", embedding.slice(0, 5));

  const client = await createConnectedClient(databaseUrl);

  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id BIGSERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        embedding VECTOR(2048) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const insertResult = await client.query(
      `INSERT INTO ${TABLE_NAME} (content, embedding) VALUES ($1, $2::vector) RETURNING id`,
      [INPUT_TEXT, vectorLiteral]
    );

    const insertedId = insertResult.rows[0].id;

    const dimensionResult = await client.query(
      `SELECT vector_dims(embedding) AS dims FROM ${TABLE_NAME} WHERE id = $1`,
      [insertedId]
    );

    const cosineResult = await client.query(
      `
      SELECT
        id,
        content,
        embedding <=> $1::vector AS cosine_distance
      FROM ${TABLE_NAME}
      ORDER BY embedding <=> $1::vector ASC
      LIMIT 1
      `,
      [vectorLiteral]
    );

    console.log("Inserted row id:", insertedId);
    console.log("Stored vector dimension:", Number(dimensionResult.rows[0].dims));
    console.log("Cosine query top match:", cosineResult.rows[0]);
    console.log("Success: OpenRouter -> PostgreSQL pgvector pipeline is working.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("E2E test failed:");
  console.error(error);
  process.exit(1);
});
