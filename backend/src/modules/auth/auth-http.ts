import type { ServerResponse } from "node:http";
import type { AuthUser } from "./auth.types.js";
import { AuthEmailService } from "./auth-email.service.js";
import {
  AuthError,
  AuthService,
  normalizeEmail,
  type RegisterInput,
} from "./auth.service.js";
import {
  createRateLimitKey,
  type RateLimitDecision,
  type RateLimiter,
} from "./rate-limit.service.js";
import {
  CSRF_HEADER_NAME,
  createCsrfToken,
  isCsrfTokenValid,
  readCsrfCookie,
  serializeCsrfCookie,
} from "./csrf.service.js";

export const AUTH_SESSION_COOKIE_NAME = "synapse_auth_session";

export const AUTH_PATHS = {
  register: "/auth/register",
  login: "/auth/login",
  logout: "/auth/logout",
  session: "/auth/session",
  verifyEmail: "/auth/verify-email",
  requestEmailVerification: "/auth/email-verification/request",
  requestPasswordReset: "/auth/password-reset/request",
  confirmPasswordReset: "/auth/password-reset/confirm",
  csrf: "/auth/csrf",
} as const;

type JsonObject = Record<string, unknown>;

export interface AuthHttpDependencies {
  authService: AuthService;
  emailService: AuthEmailService;
  isProduction: boolean;
  rateLimiter: RateLimiter;
  rateLimitEnabled: boolean;
  clientIp: string;
  maxBodyBytes: number;
  csrfEnabled: boolean;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  response.end(JSON.stringify(payload));
}

function sendRateLimitedResponse(response: ServerResponse, decision: RateLimitDecision): void {
  response.setHeader("Retry-After", String(decision.retryAfterSeconds));
  sendJson(response, 429, { error: "Too many requests. Please try again later." });
}

function toPublicUser(user: AuthUser): {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
} {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: Boolean(user.emailVerifiedAt),
    emailVerifiedAt: user.emailVerifiedAt,
  };
}

function readCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex === -1 || cookie.slice(0, separatorIndex).trim() !== name) {
      continue;
    }

    const value = cookie.slice(separatorIndex + 1).trim();

    try {
      return value ? decodeURIComponent(value) : null;
    } catch {
      return null;
    }
  }

  return null;
}

export function readAuthSessionToken(request: Request): string | null {
  return readCookieValue(request, AUTH_SESSION_COOKIE_NAME);
}

export function serializeAuthSessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean
): string {
  return `${AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearAuthSessionCookie(secure: boolean): string {
  return `${AUTH_SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

async function readJsonBody(request: Request, maxBytes: number): Promise<JsonObject> {
  const contentLengthHeader = request.headers.get("content-length");

  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);

    if (!Number.isInteger(contentLength) || contentLength < 0 || contentLength > maxBytes) {
      throw new AuthError("INVALID_INPUT", "Request body is too large");
    }
  }

  if (!request.body) {
    throw new AuthError("INVALID_INPUT", "Request body must be valid JSON");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new AuthError("INVALID_INPUT", "Request body is too large");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;

  try {
    value = JSON.parse(new TextDecoder().decode(bodyBytes)) as unknown;
  } catch {
    throw new AuthError("INVALID_INPUT", "Request body must be valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError("INVALID_INPUT", "Request body must be a JSON object");
  }

  return value as JsonObject;
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ACTION_WINDOW_MS = 60 * 60 * 1000;

function allowRateLimitedRequest(
  response: ServerResponse,
  dependencies: AuthHttpDependencies,
  scope: string,
  value: string,
  limit: number,
  windowMs: number
): boolean {
  if (!dependencies.rateLimitEnabled) {
    return true;
  }

  const decision = dependencies.rateLimiter.check(
    createRateLimitKey(scope, value),
    limit,
    windowMs
  );

  if (!decision.allowed) {
    sendRateLimitedResponse(response, decision);
    return false;
  }

  return true;
}

function requiredString(body: JsonObject, field: string): string {
  const value = body[field];

  if (typeof value !== "string") {
    throw new AuthError("INVALID_INPUT", `${field} is required`);
  }

  return value;
}

function getErrorResponse(error: unknown): { statusCode: number; message: string } {
  if (error instanceof AuthError) {
    return { statusCode: error.statusCode, message: error.message };
  }

  console.error("Authentication request failed:", error);
  return { statusCode: 500, message: "Authentication request failed" };
}

async function deliverEmail(
  action: string,
  send: () => Promise<void>
): Promise<boolean> {
  try {
    await send();
    return true;
  } catch (error) {
    console.error(`${action} email delivery failed:`, error);
    return false;
  }
}

function setSessionCookie(
  response: ServerResponse,
  token: string,
  expiresAt: Date,
  isProduction: boolean
): void {
  const maxAgeSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  response.setHeader(
    "Set-Cookie",
    serializeAuthSessionCookie(token, maxAgeSeconds, isProduction)
  );
}

function sendSessionResponse(
  response: ServerResponse,
  statusCode: number,
  session: { token: string; context: { sessionId: string; user: AuthUser; expiresAt: Date } },
  isProduction: boolean,
  extra: Record<string, unknown> = {}
): void {
  setSessionCookie(response, session.token, session.context.expiresAt, isProduction);
  sendJson(response, statusCode, {
    sessionId: session.context.sessionId,
    sessionMode: "user",
    user: toPublicUser(session.context.user),
    expiresAt: session.context.expiresAt.toISOString(),
    ...extra,
  });
}

export async function handleAuthRequest(
  request: Request,
  response: ServerResponse,
  dependencies: AuthHttpDependencies
): Promise<void> {
  const url = new URL(request.url);
  const token = readAuthSessionToken(request);

  try {
    if (request.method === "GET" && url.pathname === AUTH_PATHS.session) {
      const session = token ? await dependencies.authService.resolveSession(token) : null;

      if (!session) {
        sendJson(response, 401, { error: "No active account session" });
        return;
      }

      sendJson(response, 200, {
        sessionId: session.sessionId,
        sessionMode: "user",
        user: toPublicUser(session.user),
        expiresAt: session.expiresAt.toISOString(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === AUTH_PATHS.csrf) {
      const csrfToken = readCsrfCookie(request) || createCsrfToken();
      response.setHeader("Set-Cookie", serializeCsrfCookie(csrfToken, dependencies.isProduction));
      sendJson(response, 200, { csrfToken });
      return;
    }

    if (
      dependencies.csrfEnabled &&
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      !isCsrfTokenValid(request.headers.get("cookie"), request.headers.get(CSRF_HEADER_NAME))
    ) {
      sendJson(response, 403, { error: "Invalid CSRF token" });
      return;
    }

    if (request.method === "POST" && url.pathname === AUTH_PATHS.verifyEmail) {
      const body = await readJsonBody(request, dependencies.maxBodyBytes);
      const verificationToken = requiredString(body, "token").trim();

      if (!verificationToken) {
        throw new AuthError("INVALID_INPUT", "Verification token is required");
      }

      const user = await dependencies.authService.verifyEmail(verificationToken);
      sendJson(response, 200, { verified: true, user: toPublicUser(user) });
      return;
    }

    if (request.method === "POST" && url.pathname === AUTH_PATHS.register) {
      if (!allowRateLimitedRequest(response, dependencies, "auth:register:ip", dependencies.clientIp, 10, ACTION_WINDOW_MS)) {
        return;
      }

      const body = await readJsonBody(request, dependencies.maxBodyBytes);
      const input: RegisterInput = {
        name: requiredString(body, "name"),
        email: requiredString(body, "email"),
        password: requiredString(body, "password"),
      };

      const email = normalizeEmail(input.email);

      if (!allowRateLimitedRequest(response, dependencies, "auth:register:email", email, 3, ACTION_WINDOW_MS)) {
        return;
      }

      const result = await dependencies.authService.register(input);
      const verificationEmailSent = await deliverEmail(
        "Verification",
        () => dependencies.emailService.sendVerificationEmail(result.verification.user, result.verification.token)
      );

      sendSessionResponse(response, 201, result.session, dependencies.isProduction, {
        emailVerificationRequired: true,
        verificationEmailSent,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === AUTH_PATHS.login) {
      if (!allowRateLimitedRequest(response, dependencies, "auth:login:ip", dependencies.clientIp, 30, LOGIN_WINDOW_MS)) {
        return;
      }

      const body = await readJsonBody(request, dependencies.maxBodyBytes);
      const email = normalizeEmail(requiredString(body, "email"));

      if (!allowRateLimitedRequest(response, dependencies, "auth:login:email", email, 5, LOGIN_WINDOW_MS)) {
        return;
      }

      const session = await dependencies.authService.login(
        email,
        requiredString(body, "password")
      );
      dependencies.rateLimiter.reset(createRateLimitKey("auth:login:email", email));
      sendSessionResponse(response, 200, session, dependencies.isProduction);
      return;
    }

    if (request.method === "POST" && url.pathname === AUTH_PATHS.logout) {
      if (token) {
        await dependencies.authService.revokeSession(token);
      }

      response.setHeader("Set-Cookie", clearAuthSessionCookie(dependencies.isProduction));
      sendJson(response, 200, { loggedOut: true });
      return;
    }

    if (request.method === "POST" && url.pathname === AUTH_PATHS.requestEmailVerification) {
      if (!token) {
        throw new AuthError("INVALID_CREDENTIALS", "Authentication required", 401);
      }

      if (!allowRateLimitedRequest(response, dependencies, "auth:verify-request:ip", dependencies.clientIp, 10, ACTION_WINDOW_MS)) {
        return;
      }

      const session = await dependencies.authService.resolveSession(token);

      if (!session) {
        throw new AuthError("INVALID_CREDENTIALS", "Authentication required", 401);
      }

      if (!allowRateLimitedRequest(response, dependencies, "auth:verify-request:user", session.user.id, 3, ACTION_WINDOW_MS)) {
        return;
      }

      const verification = await dependencies.authService.requestEmailVerification(session.user.id);

      if (!verification) {
        sendJson(response, 200, { alreadyVerified: true, emailSent: false });
        return;
      }

      const emailSent = await deliverEmail(
        "Verification",
        () => dependencies.emailService.sendVerificationEmail(verification.user, verification.token)
      );
      sendJson(response, 202, { alreadyVerified: false, emailSent });
      return;
    }

    if (request.method === "POST" && url.pathname === AUTH_PATHS.requestPasswordReset) {
      if (!allowRateLimitedRequest(response, dependencies, "auth:reset-request:ip", dependencies.clientIp, 10, ACTION_WINDOW_MS)) {
        return;
      }

      const body = await readJsonBody(request, dependencies.maxBodyBytes);
      const email = normalizeEmail(requiredString(body, "email"));

      if (!allowRateLimitedRequest(response, dependencies, "auth:reset-request:email", email, 3, ACTION_WINDOW_MS)) {
        return;
      }

      const result = await dependencies.authService.requestPasswordReset(
        email
      );

      if (result) {
        await deliverEmail(
          "Password reset",
          () => dependencies.emailService.sendPasswordResetEmail(result.user, result.token)
        );
      }

      sendJson(response, 202, {
        message: "If an account exists for that email, recovery instructions will be sent.",
      });
      return;
    }

    if (request.method === "POST" && url.pathname === AUTH_PATHS.confirmPasswordReset) {
      if (!allowRateLimitedRequest(response, dependencies, "auth:reset-confirm:ip", dependencies.clientIp, 10, ACTION_WINDOW_MS)) {
        return;
      }

      const body = await readJsonBody(request, dependencies.maxBodyBytes);
      await dependencies.authService.resetPassword(
        requiredString(body, "token"),
        requiredString(body, "password")
      );
      response.setHeader("Set-Cookie", clearAuthSessionCookie(dependencies.isProduction));
      sendJson(response, 200, { passwordReset: true });
      return;
    }

    response.setHeader("Allow", "GET, POST, OPTIONS");
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const errorResponse = getErrorResponse(error);
    sendJson(response, errorResponse.statusCode, { error: errorResponse.message });
  }
}