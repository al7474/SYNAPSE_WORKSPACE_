import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, "../..");
const repoRoot = path.resolve(backendDir, "..");

dotenv.config({ path: path.join(backendDir, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env") });

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL. Set it in backend/.env or .env");
  }

  return databaseUrl;
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function waitForDatabase(pool: Pool, attempts = 20, delayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function getMigrationFiles(migrationsDir: string): Promise<string[]> {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

async function applyMigration(pool: Pool, migrationsDir: string, fileName: string): Promise<void> {
  const alreadyApplied = await pool.query(
    "SELECT 1 FROM schema_migrations WHERE version = $1",
    [fileName]
  );

  if (alreadyApplied.rowCount !== 0) {
    console.log(`Skipping ${fileName} (already applied)`);
    return;
  }

  const sql = await fs.readFile(path.join(migrationsDir, fileName), "utf8");

  await pool.query("BEGIN");

  try {
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations (version) VALUES ($1)", [fileName]);
    await pool.query("COMMIT");
    console.log(`Applied ${fileName}`);
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  const databaseUrl = requireDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl });
  const migrationsDir = path.join(backendDir, "db", "migrations");

  try {
    await waitForDatabase(pool);
    await ensureMigrationsTable(pool);

    const files = await getMigrationFiles(migrationsDir);

    for (const fileName of files) {
      await applyMigration(pool, migrationsDir, fileName);
    }

    console.log("Migrations completed.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:");
  console.error(error);
  process.exit(1);
});
