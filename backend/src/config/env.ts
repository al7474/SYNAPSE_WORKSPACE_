import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, "../..");
const repoRoot = path.resolve(backendDir, "..");

// Prefer backend/.env for backend runtime, then fill missing values from root .env.
dotenv.config({ path: path.join(backendDir, ".env"), override: true });
dotenv.config({ path: path.join(repoRoot, ".env") });

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export const env = {
  port: Number(process.env.PORT || 4000),
  isProduction: process.env.NODE_ENV === "production",
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
  databaseUrl: requireEnv("DATABASE_URL"),
  openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
  embeddingModel:
    process.env.OPENROUTER_EMBEDDING_MODEL || "nvidia/llama-nemotron-embed-vl-1b-v2:free",
  embeddingDimension: Number(process.env.OPENROUTER_EMBEDDING_DIMENSION || 1024),
  pendingReindexIntervalMs: Number(process.env.PENDING_REINDEX_INTERVAL_MS || 15000),
  pendingReindexBatchSize: Number(process.env.PENDING_REINDEX_BATCH_SIZE || 20),
  guestSessionTtlMs: Number(process.env.GUEST_SESSION_TTL_MS || 86400000),
  guestSessionCleanupIntervalMs: Number(
    process.env.GUEST_SESSION_CLEANUP_INTERVAL_MS || 3600000
  ),
};
