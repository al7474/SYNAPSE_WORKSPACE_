import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export const env = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: requireEnv("DATABASE_URL"),
  openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
  embeddingModel:
    process.env.OPENROUTER_EMBEDDING_MODEL || "nvidia/llama-nemotron-embed-vl-1b-v2:free",
  pendingReindexIntervalMs: Number(process.env.PENDING_REINDEX_INTERVAL_MS || 15000),
  pendingReindexBatchSize: Number(process.env.PENDING_REINDEX_BATCH_SIZE || 20),
};
