import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthEmailProvider } from "../modules/auth/auth-email.service.js";

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

const port = Number(process.env.PORT || 4000);
const isProduction = process.env.NODE_ENV === "production";
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

function readAuthEmailProvider(): AuthEmailProvider {
  const value = process.env.AUTH_EMAIL_PROVIDER || (isProduction ? "resend" : "console");

  if (value === "console" || value === "resend") {
    return value;
  }

  throw new Error("AUTH_EMAIL_PROVIDER must be either console or resend");
}

const authEmailProvider = readAuthEmailProvider();

export const env = {
  port,
  isProduction,
  frontendOrigin,
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
  authSessionTtlMs: Number(process.env.AUTH_SESSION_TTL_MS || 2592000000),
  authActionTokenTtlMs: Number(process.env.AUTH_ACTION_TOKEN_TTL_MS || 3600000),
  authCleanupIntervalMs: Number(process.env.AUTH_CLEANUP_INTERVAL_MS || 3600000),
  authBcryptCost: Number(process.env.AUTH_BCRYPT_COST || 12),
  authPublicUrl: process.env.AUTH_PUBLIC_URL || `http://localhost:${port}`,
  authFrontendUrl: process.env.AUTH_FRONTEND_URL || frontendOrigin,
  authEmailProvider,
  authEmailFrom: process.env.AUTH_EMAIL_FROM || "",
  resendApiKey: process.env.RESEND_API_KEY || "",
};
