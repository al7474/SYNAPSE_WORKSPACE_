import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|csrf|password|secret|token|ticket|api[-_]?key|session)/i;
const SENSITIVE_QUERY_PATTERN = /([?#&](?:share(?:Token)?|token|ticket|csrf(?:Token)?|session(?:Id)?|code)=)[^&#\s]*/gi;
const BEARER_PATTERN = /(Bearer\s+)[^\s]+/gi;
const SAFE_BOOLEAN_STATUS_KEYS = new Set(["sharetokenpresent", "tokenredacted"]);

function isSensitiveKey(key: string, value: unknown): boolean {
  const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();

  if (SAFE_BOOLEAN_STATUS_KEYS.has(normalizedKey) && typeof value === "boolean") {
    return false;
  }

  return SENSITIVE_KEY_PATTERN.test(key);
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(SENSITIVE_QUERY_PATTERN, `$1${REDACTED_VALUE}`)
    .replace(BEARER_PATTERN, `$1${REDACTED_VALUE}`);
}

export function redactShareToken(token: string | null | undefined): string | null {
  return token ? REDACTED_VALUE : null;
}

export function sanitizeLogValue(
  value: unknown,
  key = "",
  depth = 0
): unknown {
  if (isSensitiveKey(key, value)) {
    return REDACTED_VALUE;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
      stack: value.stack ? redactSensitiveText(value.stack) : undefined,
    };
  }

  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (depth >= 4) {
    return "[TRUNCATED]";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, key, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};

  for (const [childKey, childValue] of Object.entries(value)) {
    sanitized[childKey] = sanitizeLogValue(childValue, childKey, depth + 1);
  }

  return sanitized;
}

export function sanitizeLogFields(fields: LogFields): LogFields {
  return sanitizeLogValue(fields) as LogFields;
}

function writeLog(level: LogLevel, event: string, fields: LogFields): void {
  const record = {
    ...sanitizeLogFields(fields),
    timestamp: new Date().toISOString(),
    level,
    service: "synapse-backend",
    event,
  };
  const output = `${JSON.stringify(record)}\n`;

  if (level === "error") {
    process.stderr.write(output);
    return;
  }

  process.stdout.write(output);
}

export const logger = {
  debug(event: string, fields: LogFields = {}): void {
    writeLog("debug", event, fields);
  },
  info(event: string, fields: LogFields = {}): void {
    writeLog("info", event, fields);
  },
  warn(event: string, fields: LogFields = {}): void {
    writeLog("warn", event, fields);
  },
  error(event: string, fields: LogFields = {}): void {
    writeLog("error", event, fields);
  },
};

export function createRequestId(): string {
  return randomUUID();
}

export function getRequestPath(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl || "/", "http://localhost").pathname;
  } catch {
    return "/unknown";
  }
}