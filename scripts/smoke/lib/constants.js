export const OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings";
export const DEFAULT_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL || "nvidia/llama-nemotron-embed-vl-1b-v2:free";
export const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres@127.0.0.1:55432/synapse_test";
export const DEFAULT_NOTES_TABLE = process.env.SMOKE_NOTES_TABLE || "notes_smoke";
