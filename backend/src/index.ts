import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createPubSub, createYoga } from "graphql-yoga";
import { Redis } from "@upstash/redis";
import { PrismaClient } from "@prisma/client";
import { env } from "./config/env.js";
import { buildSchema } from "./graphql/schema.js";
import { OpenRouterEmbeddingsService } from "./modules/embeddings/openrouter-embeddings.service.js";
import {
  clearGuestSessionCookie,
  GuestSessionService,
  readGuestSessionToken,
  serializeGuestSessionCookie,
} from "./modules/auth/guest-session.service.js";
import type { OwnerMetadata } from "./modules/auth/auth.types.js";
import { AuthEmailService } from "./modules/auth/auth-email.service.js";
import {
  AUTH_PATHS,
  handleAuthRequest,
  readAuthSessionToken,
} from "./modules/auth/auth-http.js";
import { AuthService } from "./modules/auth/auth.service.js";
import {
  createRateLimitKey,
  InMemoryRateLimiter,
  UpstashRateLimiter,
  type RateLimitDecision,
  type RateLimiter,
} from "./modules/auth/rate-limit.service.js";
import { CSRF_HEADER_NAME, isCsrfTokenValid } from "./modules/auth/csrf.service.js";
import { NotesService } from "./modules/notes/notes.service.js";
import type { Note } from "./modules/notes/notes.types.js";

const GUEST_SESSION_PATH = "/auth/guest-session";
const AUTH_PATH_SET = new Set<string>(Object.values(AUTH_PATHS));
const HEALTH_PATH = "/healthz";
const READINESS_PATH = "/readyz";

function setAuthCorsHeaders(request: Request, response: ServerResponse): void {
  const requestOrigin = request.headers.get("origin");

  if (!requestOrigin || requestOrigin === env.frontendOrigin) {
    response.setHeader("Access-Control-Allow-Origin", env.frontendOrigin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("Vary", "Origin");
  }
}

function hasTrustedOrigin(request: Request, expectedOrigin: string): boolean {
  const requestOrigin = request.headers.get("origin");

  if (requestOrigin) {
    return requestOrigin === expectedOrigin;
  }

  const referer = request.headers.get("referer");

  if (!referer) {
    return false;
  }

  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  response.end(JSON.stringify(payload));
}

function sendHealthResponse(
  response: ServerResponse,
  statusCode: number,
  payload: { status: string }
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function setSecurityHeaders(response: ServerResponse, isProduction: boolean): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");

  if (isProduction) {
    response.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
}

function getClientIp(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwardedFor = request.headers["x-forwarded-for"];

    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
      return forwardedFor.split(",")[0].trim();
    }
  }

  return request.socket.remoteAddress || "unknown";
}

async function handleGuestSessionRequest(
  request: Request,
  response: ServerResponse,
  dependencies: {
    guestSessions: GuestSessionService;
    rateLimiter: RateLimiter;
    rateLimitEnabled: boolean;
    clientIp: string;
    csrfEnabled: boolean;
    isProduction: boolean;
    frontendOrigin: string;
  }
): Promise<void> {
  setAuthCorsHeaders(request, response);

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  const guestSessionCookieValue = readGuestSessionToken(request);

  if (
    dependencies.isProduction &&
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    !hasTrustedOrigin(request, dependencies.frontendOrigin)
  ) {
    sendJson(response, 403, { error: "Request origin is not allowed" });
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

  if (request.method === "GET") {
    const session = guestSessionCookieValue
      ? await dependencies.guestSessions.resolve(guestSessionCookieValue)
      : null;

    if (!session) {
      sendJson(response, 401, { error: "No active demo session" });
      return;
    }

    sendJson(response, 200, {
      sessionId: session.ownerId,
      sessionMode: "guest",
      userEmail: null,
      expiresAt: session.expiresAt.toISOString(),
    });
    return;
  }

  if (request.method === "POST") {
    if (dependencies.rateLimitEnabled) {
      let decision: RateLimitDecision;

      try {
        decision = await dependencies.rateLimiter.check(
          createRateLimitKey("auth:guest-session:ip", dependencies.clientIp),
          20,
          60 * 60 * 1000
        );
      } catch (error) {
        console.error("Guest session rate limiter unavailable:", error);
        sendJson(response, 503, { error: "Authentication service temporarily unavailable" });
        return;
      }

      if (!decision.allowed) {
        response.setHeader("Retry-After", String(decision.retryAfterSeconds));
        sendJson(response, 429, { error: "Too many requests. Please try again later." });
        return;
      }
    }

    const session = await dependencies.guestSessions.createOrReuse(guestSessionCookieValue);
    const maxAgeSeconds = Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));

    response.setHeader(
      "Set-Cookie",
      serializeGuestSessionCookie(session.token, maxAgeSeconds, env.isProduction)
    );
    sendJson(response, 201, {
      sessionId: session.ownerId,
      sessionMode: "guest",
      userEmail: null,
      expiresAt: session.expiresAt.toISOString(),
    });
    return;
  }

  if (request.method === "DELETE") {
    if (guestSessionCookieValue) {
      await dependencies.guestSessions.revoke(guestSessionCookieValue);
    }

    response.setHeader("Set-Cookie", clearGuestSessionCookie(env.isProduction));
    sendJson(response, 200, { deleted: true });
    return;
  }

  response.setHeader("Allow", "GET, POST, DELETE, OPTIONS");
  sendJson(response, 405, { error: "Method not allowed" });
}

async function bootstrap() {
  const db = new PrismaClient();
  await db.$connect();
  const intervals = new Set<NodeJS.Timeout>();
  const rateLimiter: RateLimiter =
    env.authRateLimitStore === "upstash"
      ? new UpstashRateLimiter(
          new Redis({
            url: env.upstashRedisRestUrl,
            token: env.upstashRedisRestToken,
            enableTelemetry: false,
          })
        )
      : new InMemoryRateLimiter(env.authRateLimitMaxKeys);
  const pubSub = createPubSub<{ NOTE_UPDATED: [Note] }>();
  const embeddingsService = new OpenRouterEmbeddingsService(
    env.openRouterApiKey,
    env.embeddingModel,
    env.embeddingDimension
  );
  const guestSessions = new GuestSessionService(db, env.guestSessionTtlMs);
  const authService = new AuthService(db, {
    sessionTtlMs: env.authSessionTtlMs,
    actionTokenTtlMs: env.authActionTokenTtlMs,
    bcryptCost: env.authBcryptCost,
  });
  const authEmailService = new AuthEmailService({
    provider: env.authEmailProvider,
    apiKey: env.resendApiKey,
    from: env.authEmailFrom,
    backendPublicUrl: env.authPublicUrl,
    frontendUrl: env.authFrontendUrl,
    isProduction: env.isProduction,
  });
  const notesService = new NotesService(db, embeddingsService);

  const yoga = createYoga({
    schema: buildSchema({
      publish: async (topic, payload) => {
        await pubSub.publish(topic, payload);
      },
      subscribe: (topic) => pubSub.subscribe(topic),
    }),
    context: async ({ request }) => {
      const authSessionCookieValue = readAuthSessionToken(request);

      if (authSessionCookieValue) {
        const authSession = await authService.resolveSession(authSessionCookieValue);

        return {
          notesService,
          sessionId: authSession?.user.id ?? null,
          userEmail: authSession?.user.email ?? null,
          emailVerified: Boolean(authSession?.user.emailVerifiedAt),
          ownerMetadata: authSession
            ? { ownerKind: "user", ownerUserId: authSession.user.id }
            : { ownerKind: "legacy" },
          revalidateSession: async () =>
            Boolean(await authService.resolveSession(authSessionCookieValue)),
        };
      }

      const guestSessionCookieValue = readGuestSessionToken(request);

      if (guestSessionCookieValue) {
        const guestSession = await guestSessions.resolve(guestSessionCookieValue);
        const ownerMetadata: OwnerMetadata = guestSession
          ? { ownerKind: "guest", ownerGuestSessionId: guestSession.id }
          : { ownerKind: "legacy" };

        return {
          notesService,
          sessionId: guestSession?.ownerId ?? null,
          userEmail: null as string | null,
          emailVerified: false,
          ownerMetadata,
          revalidateSession: async () =>
            Boolean(await guestSessions.resolve(guestSessionCookieValue)),
        };
      }

      const ownerMetadata: OwnerMetadata = { ownerKind: "legacy" };

      return {
        notesService,
        sessionId: null,
        userEmail: null as string | null,
        emailVerified: false,
        ownerMetadata,
        revalidateSession: async () => false,
      };
    },
    cors: {
      origin: env.frontendOrigin,
      credentials: true,
      allowedHeaders: ["Content-Type", "X-CSRF-Token"],
    },
    graphiql: !env.isProduction,
  });

  const server = createServer((request, response) => {
    setSecurityHeaders(response, env.isProduction);
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (requestUrl.pathname === HEALTH_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        sendHealthResponse(response, 405, { status: "method_not_allowed" });
        return;
      }

      sendHealthResponse(response, 200, { status: "ok" });
      return;
    }

    if (requestUrl.pathname === READINESS_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        sendHealthResponse(response, 405, { status: "method_not_allowed" });
        return;
      }

      void db.$queryRaw`SELECT 1`
        .then(() => sendHealthResponse(response, 200, { status: "ready" }))
        .catch((error: unknown) => {
          console.error("Readiness check failed:", error);

          if (!response.headersSent) {
            sendHealthResponse(response, 503, { status: "not_ready" });
          }
        });
      return;
    }

    if (requestUrl.pathname === GUEST_SESSION_PATH || AUTH_PATH_SET.has(requestUrl.pathname)) {
      const requestInit: RequestInit & { duplex?: "half" } = {
        method: request.method,
        headers: request.headers as HeadersInit,
      };

      if (request.method !== "GET" && request.method !== "HEAD") {
        requestInit.body = request as unknown as BodyInit;
        requestInit.duplex = "half";
      }

      const webRequest = new Request(
        `http://${request.headers.host || "localhost"}${request.url || "/"}`,
        requestInit
      );

      setAuthCorsHeaders(webRequest, response);

      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }

      if (
        env.isProduction &&
        webRequest.method !== "GET" &&
        webRequest.method !== "HEAD" &&
        !hasTrustedOrigin(webRequest, env.frontendOrigin)
      ) {
        sendJson(response, 403, { error: "Request origin is not allowed" });
        return;
      }

      const handler = requestUrl.pathname === GUEST_SESSION_PATH
        ? handleGuestSessionRequest(webRequest, response, {
            guestSessions,
            rateLimiter,
            rateLimitEnabled: env.authRateLimitEnabled,
            clientIp: getClientIp(request, env.trustProxy),
            csrfEnabled: env.authCsrfEnabled,
            isProduction: env.isProduction,
            frontendOrigin: env.frontendOrigin,
          })
        : handleAuthRequest(webRequest, response, {
            authService,
            emailService: authEmailService,
            isProduction: env.isProduction,
            rateLimiter,
            rateLimitEnabled: env.authRateLimitEnabled,
            clientIp: getClientIp(request, env.trustProxy),
            maxBodyBytes: env.authBodyMaxBytes,
            csrfEnabled: env.authCsrfEnabled,
          });

      void handler.catch((error) => {
        console.error("Guest session request failed:", error);

        if (!response.headersSent) {
          sendJson(response, 500, { error: "Guest session request failed" });
        } else {
          response.end();
        }
      });
      return;
    }

    if (
      env.isProduction &&
      request.method === "POST" &&
      !hasTrustedOrigin(
        new Request(`http://${request.headers.host || "localhost"}${request.url || "/"}`, {
          method: "POST",
          headers: request.headers as HeadersInit,
        }),
        env.frontendOrigin
      )
    ) {
      sendJson(response, 403, { error: "Request origin is not allowed" });
      return;
    }

    if (
      env.authCsrfEnabled &&
      request.method === "POST"
    ) {
      const csrfHeader = request.headers[CSRF_HEADER_NAME];
      const csrfHeaderValue = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

      if (!isCsrfTokenValid(request.headers.cookie, csrfHeaderValue)) {
        sendJson(response, 403, { error: "Invalid CSRF token" });
        return;
      }
    }

    void yoga(request, response);
  });

  server.listen(env.port, () => {
    console.log(`Backend running on http://localhost:${env.port}/graphql`);
  });

  if (env.pendingReindexIntervalMs > 0) {
    let running = false;
    const intervalId = setInterval(async () => {
      if (running) {
        return;
      }

      running = true;

      try {
        const updatedNotes = await notesService.reindexPendingEmbeddings(env.pendingReindexBatchSize);

        for (const note of updatedNotes) {
          await pubSub.publish("NOTE_UPDATED", note);
        }
      } catch (error) {
        const authErrorCode = (error as { code?: string } | null)?.code;

        if (authErrorCode === "28P01") {
          clearInterval(intervalId);
          intervals.delete(intervalId);
          console.error(
            "Pending reindex worker disabled due to database auth error (28P01). " +
              "Verify backend DATABASE_URL credentials and recreate local DB volume if needed."
          );
        } else {
          console.error("Pending reindex worker error:", error);
        }
      } finally {
        running = false;
      }
    }, env.pendingReindexIntervalMs);
    intervals.add(intervalId);
  }

  if (env.guestSessionCleanupIntervalMs > 0) {
    let running = false;
    const intervalId = setInterval(async () => {
      if (running) {
        return;
      }

      running = true;

      try {
        await guestSessions.purgeExpired();
      } catch (error) {
        console.error("Guest session cleanup error:", error);
      } finally {
        running = false;
      }
    }, env.guestSessionCleanupIntervalMs);

    intervals.add(intervalId);
    intervalId.unref();
  }

  if (env.authCleanupIntervalMs > 0) {
    let running = false;
    const intervalId = setInterval(async () => {
      if (running) {
        return;
      }

      running = true;

      try {
        await authService.purgeExpired();
        await rateLimiter.purgeExpired();
      } catch (error) {
        console.error("Authentication cleanup error:", error);
      } finally {
        running = false;
      }
    }, env.authCleanupIntervalMs);

    intervals.add(intervalId);
    intervalId.unref();
  }

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (signal: string): void => {
    if (shutdownPromise) {
      return;
    }

    shutdownPromise = new Promise<void>((resolve, reject) => {
      console.log(`Received ${signal}; shutting down backend`);

      for (const intervalId of intervals) {
        clearInterval(intervalId);
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    })
      .then(() => db.$disconnect())
      .catch((error: unknown) => {
        console.error("Backend shutdown failed:", error);
        process.exitCode = 1;
      });

    void shutdownPromise;
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
