import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthEmailProvider } from "../modules/auth/auth-email.service.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, "../..");
const repoRoot = path.resolve(backendDir, "..");

// Prefer backend/.env for backend runtime, then fill missing values from root .env.
dotenv.config({ path: path.join(backendDir, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env") });

type NodeEnvironment = "development" | "test" | "production";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function readNodeEnvironment(): NodeEnvironment {
  const value = process.env.NODE_ENV?.trim();

  if (!value) {
    throw new Error(
      "NODE_ENV is required. Use NODE_ENV=development locally or NODE_ENV=production in hosting."
    );
  }

  if (value === "development" || value === "test" || value === "production") {
    return value;
  }

  throw new Error("NODE_ENV must be development, test, or production");
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

function parseUrl(name: string, value: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error(`${name} must include a hostname and cannot include credentials`);
  }

  return parsed;
}

function readOrigin(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  const parsed = parseUrl(name, value);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${name} must contain only the origin, without a path, query, or hash`);
  }

  if (isProduction && parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production`);
  }

  return parsed.origin;
}

function assertHttpsUrl(name: string, value: string): void {
  const parsed = parseUrl(name, value);

  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production`);
  }
}

const nodeEnvironment = readNodeEnvironment();
const isProduction = nodeEnvironment === "production";
const port = readPositiveInteger("PORT", 4000);
const frontendOrigin = readOrigin("FRONTEND_ORIGIN", "http://localhost:3000");
const authPublicUrl = readOrigin("AUTH_PUBLIC_URL", `http://localhost:${port}`);
const authFrontendUrl = readOrigin("AUTH_FRONTEND_URL", frontendOrigin);
const authRateLimitEnabled = readBoolean("AUTH_RATE_LIMIT_ENABLED", true);
const authRateLimitStore = readAuthRateLimitStore();
const upstashRedisRestUrl = process.env.UPSTASH_REDIS_REST_URL || "";
const upstashRedisRestToken = process.env.UPSTASH_REDIS_REST_TOKEN || "";

function readAuthEmailProvider(): AuthEmailProvider {
  const value = process.env.AUTH_EMAIL_PROVIDER?.trim() || (isProduction ? "" : "console");

  if (!value) {
    throw new Error("AUTH_EMAIL_PROVIDER is required in production and must be resend");
  }

  if (value === "console" || value === "resend") {
    return value;
  }

  throw new Error("AUTH_EMAIL_PROVIDER must be either console or resend");
}

const authEmailProvider = readAuthEmailProvider();
const authEmailFrom = process.env.AUTH_EMAIL_FROM?.trim() || "";
const resendApiKey = process.env.RESEND_API_KEY?.trim() || "";
const authCsrfEnabled = readBoolean("AUTH_CSRF_ENABLED", true);
const trustProxy = readBoolean("TRUST_PROXY", false);
const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim() || "";
const sentryDsn = process.env.SENTRY_DSN?.trim() || "";
const sentryEnvironment = process.env.SENTRY_ENVIRONMENT?.trim() || nodeEnvironment;
const sentryRelease = process.env.SENTRY_RELEASE?.trim() || "";
const defaultOpenRouterApiUrl = "https://openrouter.ai/api/v1/embeddings";
const embeddingDimension = readPositiveInteger("OPENROUTER_EMBEDDING_DIMENSION", 1024);

function readOpenRouterApiUrl(): string {
  const value = process.env.OPENROUTER_API_URL?.trim() || defaultOpenRouterApiUrl;
  const parsed = parseUrl("OPENROUTER_API_URL", value);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OPENROUTER_API_URL must use HTTP or HTTPS");
  }

  if (isProduction && parsed.protocol !== "https:") {
    throw new Error("OPENROUTER_API_URL must use HTTPS in production");
  }

  if (!isProduction && parsed.protocol === "http:") {
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

    if (!localHosts.has(parsed.hostname)) {
      throw new Error("HTTP OPENROUTER_API_URL is only allowed for a local development host");
    }
  }

  return parsed.toString();
}

const openRouterApiUrl = readOpenRouterApiUrl();

if (embeddingDimension !== 1024) {
  throw new Error("OPENROUTER_EMBEDDING_DIMENSION must be 1024 to match PostgreSQL vector(1024)");
}

if (isProduction) {
  for (const variableName of ["FRONTEND_ORIGIN", "AUTH_PUBLIC_URL", "AUTH_FRONTEND_URL"]) {
    requireEnv(variableName);
  }

  if (authFrontendUrl !== frontendOrigin) {
    throw new Error("AUTH_FRONTEND_URL must match FRONTEND_ORIGIN in production");
  }

  if (authEmailProvider !== "resend") {
    throw new Error("AUTH_EMAIL_PROVIDER=resend is required in production");
  }

  if (!authCsrfEnabled) {
    throw new Error("AUTH_CSRF_ENABLED=true is required in production");
  }

  if (!authRateLimitEnabled || authRateLimitStore !== "upstash") {
    throw new Error(
      "AUTH_RATE_LIMIT_ENABLED=true and AUTH_RATE_LIMIT_STORE=upstash are required in production"
    );
  }

  if (!trustProxy) {
    throw new Error("TRUST_PROXY=true is required when production runs behind a trusted hosting proxy");
  }

  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required in production");
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

if (authEmailProvider === "resend") {
  if (!resendApiKey || !authEmailFrom) {
    throw new Error("Resend email delivery requires RESEND_API_KEY and AUTH_EMAIL_FROM");
  }

  if (!/^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(authEmailFrom) &&
      !/^.+<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/.test(authEmailFrom)) {
    throw new Error("AUTH_EMAIL_FROM must be an email address or a display name followed by an email address");
  }

  if (authEmailFrom.includes("tu-dominio.com") || authEmailFrom.includes("example.com")) {
    throw new Error("AUTH_EMAIL_FROM must use a sender verified in Resend, not an example domain");
  }
}

export const env = {
  nodeEnvironment,
  port,
  isProduction,
  frontendOrigin,
  databaseUrl: requireEnv("DATABASE_URL"),
  openRouterApiKey,
  openRouterApiUrl,
  embeddingModel:
    process.env.OPENROUTER_EMBEDDING_MODEL || "nvidia/llama-nemotron-embed-vl-1b-v2:free",
  embeddingDimension,
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
  authEmailFrom,
  resendApiKey,
  authRateLimitEnabled,
  authRateLimitStore,
  authRateLimitMaxKeys: readPositiveInteger("AUTH_RATE_LIMIT_MAX_KEYS", 10_000),
  upstashRedisRestUrl,
  upstashRedisRestToken,
  authBodyMaxBytes: readPositiveInteger("AUTH_BODY_MAX_BYTES", 16_384),
  authCsrfEnabled,
  trustProxy,
  sentryDsn,
  sentryEnvironment,
  sentryRelease,
  embeddingPendingAlertThreshold: readPositiveInteger(
    "PENDING_EMBEDDING_ALERT_THRESHOLD",
    50
  ),
  mcpEnabled: readBoolean("MCP_ENABLED", true),
  mcpAuthorizationCodeTtlMs: readPositiveInteger("MCP_AUTH_CODE_TTL_MS", 5 * 60 * 1000),
  mcpAccessTokenTtlMs: readPositiveInteger("MCP_ACCESS_TOKEN_TTL_MS", 60 * 60 * 1000),
  mcpRefreshTokenTtlMs: readPositiveInteger("MCP_REFRESH_TOKEN_TTL_MS", 30 * 24 * 60 * 60 * 1000),
  mcpResource: `${authPublicUrl}/mcp`,
};
