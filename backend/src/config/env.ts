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

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (value === undefined || value === "") {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be either true or false`);
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name];

  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readAuthRateLimitStore(): "memory" | "upstash" {
  const value = process.env.AUTH_RATE_LIMIT_STORE || (isProduction ? "upstash" : "memory");

  if (value === "memory" || value === "upstash") {
    return value;
  }

  throw new Error("AUTH_RATE_LIMIT_STORE must be either memory or upstash");
}

function assertHttpsUrl(name: string, value: string): void {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production`);
  }
}

const port = Number(process.env.PORT || 4000);
const isProduction = process.env.NODE_ENV === "production";
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
const authPublicUrl = process.env.AUTH_PUBLIC_URL || `http://localhost:${port}`;
const authFrontendUrl = process.env.AUTH_FRONTEND_URL || frontendOrigin;
const authRateLimitEnabled = readBoolean("AUTH_RATE_LIMIT_ENABLED", true);
const authRateLimitStore = readAuthRateLimitStore();
const upstashRedisRestUrl = process.env.UPSTASH_REDIS_REST_URL || "";
const upstashRedisRestToken = process.env.UPSTASH_REDIS_REST_TOKEN || "";

function readAuthEmailProvider(): AuthEmailProvider {
  const value = process.env.AUTH_EMAIL_PROVIDER || (isProduction ? "resend" : "console");

  if (value === "console" || value === "resend") {
    return value;
  }

  throw new Error("AUTH_EMAIL_PROVIDER must be either console or resend");
}

const authEmailProvider = readAuthEmailProvider();

if (isProduction) {
  assertHttpsUrl("FRONTEND_ORIGIN", frontendOrigin);
  assertHttpsUrl("AUTH_PUBLIC_URL", authPublicUrl);
  assertHttpsUrl("AUTH_FRONTEND_URL", authFrontendUrl);

  if (authEmailProvider === "console") {
    throw new Error("AUTH_EMAIL_PROVIDER=console is not allowed in production");
  }

  if (authRateLimitEnabled && authRateLimitStore !== "upstash") {
    throw new Error("AUTH_RATE_LIMIT_STORE=upstash is required when auth rate limiting is enabled in production");
  }
}

if (authRateLimitStore === "upstash") {
  if (!upstashRedisRestUrl || !upstashRedisRestToken) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required when AUTH_RATE_LIMIT_STORE=upstash"
    );
  }

  if (isProduction) {
    assertHttpsUrl("UPSTASH_REDIS_REST_URL", upstashRedisRestUrl);
  }
}

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
  authPublicUrl,
  authFrontendUrl,
  authEmailProvider,
  authEmailFrom: process.env.AUTH_EMAIL_FROM || "",
  resendApiKey: process.env.RESEND_API_KEY || "",
  authRateLimitEnabled,
  authRateLimitStore,
  authRateLimitMaxKeys: readPositiveInteger("AUTH_RATE_LIMIT_MAX_KEYS", 10_000),
  upstashRedisRestUrl,
  upstashRedisRestToken,
  authBodyMaxBytes: readPositiveInteger("AUTH_BODY_MAX_BYTES", 16_384),
  authCsrfEnabled: readBoolean("AUTH_CSRF_ENABLED", true),
  trustProxy: readBoolean("TRUST_PROXY", false),
};
