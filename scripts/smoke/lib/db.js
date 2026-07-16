import { Client } from "pg";
import { DEFAULT_DATABASE_URL, DEFAULT_NOTES_TABLE } from "./constants.js";

export function createClient(databaseUrl = DEFAULT_DATABASE_URL) {
  return new Client({ connectionString: databaseUrl });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createConnectedClient(
  databaseUrl = DEFAULT_DATABASE_URL,
  { attempts = 10, delayMs = 800 } = {}
) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = createClient(databaseUrl);

    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;

      try {
        await client.end();
      } catch {
        // ignore cleanup errors while retrying
      }

      if (attempt < attempts) {
        await delay(delayMs);
      }
    }
  }

  throw lastError;
}

export async function ensureNotesSchema(client, tableName = DEFAULT_NOTES_TABLE) {
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding VECTOR(2048),
      embedding_pending BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function resetNotesTable(client, tableName = DEFAULT_NOTES_TABLE) {
  await client.query(`TRUNCATE TABLE ${tableName} RESTART IDENTITY`);
}
