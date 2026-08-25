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
import type { Note, DeletedNoteEvent } from "./modules/notes/notes.types.js";
import { McpOAuthService } from "./modules/mcp/oauth.service.js";
import { MCP_OAUTH_PATHS, handleMcpOAuthRequest } from "./modules/mcp/oauth-http.js";
import { MCP_HTTP_PATH, handleMcpRequest } from "./modules/mcp/mcp-http.js";
import { createRequestId, getRequestPath, logger } from "./observability/logger.js";
import {
  captureException,
  captureMessage,
  flushSentry,
  initializeSentry,
} from "./observability/sentry.js";

const GUEST_SESSION_PATH = "/auth/guest-session";
const AUTH_PATH_SET = new Set<string>(Object.values(AUTH_PATHS));
const MCP_OAUTH_PATH_SET = new Set<string>(Object.values(MCP_OAUTH_PATHS));
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

function observeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  requestPath: string
): void {
  const startedAt = Date.now();
  let completed = false;

  const complete = (termination: "finish" | "close"): void => {
    if (completed) {
      return;
    }

    completed = true;
    const status = response.statusCode || 500;
    const fields = {
      requestId,
      method: request.method || "UNKNOWN",
      path: requestPath,
      status,
      durationMs: Date.now() - startedAt,
      termination,
      stream: String(response.getHeader("content-type") || "").startsWith("text/event-stream"),
    };

    if (status >= 500) {
      logger.error("http.request.5xx", fields);
      captureMessage("http.request.5xx", "error", fields);

      if (requestPath === READINESS_PATH) {
        logger.error("backend.not_ready", fields);
        captureMessage("backend.not_ready", "error", fields);
      }
      return;
    }

    if (status >= 400) {
      logger.warn("http.request.completed", fields);
      return;
    }

    logger.info("http.request.completed", fields);
  };

  response.once("finish", () => complete("finish"));
  response.once("close", () => complete("close"));
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
        logger.error("auth.guest_session.rate_limiter_unavailable", { error });
        captureException(error, { component: "guest_session_rate_limiter" });
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
  const sentryEnabled = initializeSentry();
  logger.info("backend.starting", {
    environment: env.nodeEnvironment,
    sentryEnabled,
  });
  const db = new PrismaClient();
  await db.$connect();
  logger.info("backend.database.connected", { environment: env.nodeEnvironment });
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
  const pubSub = createPubSub<{
    NOTE_UPDATED: [Note];
    NOTE_DELETED: [DeletedNoteEvent];
  }>();
  const embeddingsService = new OpenRouterEmbeddingsService(
    env.openRouterApiKey,
    env.embeddingModel,
    env.embeddingDimension,
    { endpoint: env.openRouterApiUrl }
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
  const oauthService = new McpOAuthService(db, {
    resource: env.mcpResource,
    authorizationCodeTtlMs: env.mcpAuthorizationCodeTtlMs,
    accessTokenTtlMs: env.mcpAccessTokenTtlMs,
    refreshTokenTtlMs: env.mcpRefreshTokenTtlMs,
  });

  function subscribe(topic: "NOTE_UPDATED"): AsyncIterable<Note>;
  function subscribe(topic: "NOTE_DELETED"): AsyncIterable<DeletedNoteEvent>;
  function subscribe(
    topic: "NOTE_UPDATED" | "NOTE_DELETED"
  ): AsyncIterable<Note | DeletedNoteEvent> {
    if (topic === "NOTE_UPDATED") {
      return pubSub.subscribe("NOTE_UPDATED");
    }

    return pubSub.subscribe("NOTE_DELETED");
  }

  const yoga = createYoga({
    schema: buildSchema({
      publish: async (topic, payload) => {
        await pubSub.publish(topic, payload);
      },
      subscribe,
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
    const requestId = createRequestId();
    const requestPath = getRequestPath(request.url);
    response.setHeader("X-Request-ID", requestId);
    observeRequest(request, response, requestId, requestPath);
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
          logger.error("backend.readiness.query_failed", { error, requestId });
          captureException(error, { component: "readiness", requestId });

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
        logger.error("auth.request.handler_failed", {
          error,
          requestId,
          path: requestPath,
        });
        captureException(error, { component: "auth_request_handler", requestId });

        if (!response.headersSent) {
          sendJson(response, 500, { error: "Guest session request failed" });
        } else {
          response.end();
        }
      });
      return;
    }

    if (
      env.mcpEnabled &&
      (requestUrl.pathname === MCP_HTTP_PATH || MCP_OAUTH_PATH_SET.has(requestUrl.pathname))
    ) {
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

      const handler =
        requestUrl.pathname === MCP_HTTP_PATH
          ? handleMcpRequest(webRequest, response, {
              notesService,
              oauthService,
              publicUrl: env.authPublicUrl,
            })
          : handleMcpOAuthRequest(webRequest, response, {
              oauthService,
              authService,
              isProduction: env.isProduction,
              rateLimiter,
              rateLimitEnabled: env.authRateLimitEnabled,
              clientIp: getClientIp(request, env.trustProxy),
              maxBodyBytes: env.authBodyMaxBytes,
              publicUrl: env.authPublicUrl,
              resource: env.mcpResource,
            });

      void handler.catch((error) => {
        logger.error("mcp.request.handler_failed", { error, requestId, path: requestPath });
        captureException(error, { component: "mcp_request_handler", requestId });

        if (!response.headersSent) {
          sendJson(response, 500, { error: "MCP request failed" });
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

    try {
      yoga(request, response);
    } catch (error: unknown) {
      logger.error("graphql.request.failed", { error, requestId });
      captureException(error, { component: "graphql", requestId });

      if (!response.headersSent) {
        sendJson(response, 500, { error: "GraphQL request failed" });
      } else {
        response.end();
      }
    }
  });

  server.listen(env.port, () => {
    logger.info("backend.listening", {
      port: env.port,
      graphqlPath: "/graphql",
      processLocalRealtime: true,
    });
  });

  if (env.pendingReindexIntervalMs > 0) {
    let pendingEmbeddingAlertActive = false;
    let running = false;
    const intervalId = setInterval(async () => {
      if (running) {
        return;
      }

      running = true;

      try {
        const pendingCount = await notesService.countPendingEmbeddings();

        if (pendingCount >= env.embeddingPendingAlertThreshold) {
          if (!pendingEmbeddingAlertActive) {
            pendingEmbeddingAlertActive = true;
            logger.warn("embeddings.pending_backlog", {
              pendingCount,
              threshold: env.embeddingPendingAlertThreshold,
            });
            captureMessage("embeddings.pending_backlog", "warning", {
              pendingCount,
              threshold: env.embeddingPendingAlertThreshold,
            });
          }
        } else if (pendingEmbeddingAlertActive) {
          pendingEmbeddingAlertActive = false;
          logger.info("embeddings.pending_backlog_resolved", { pendingCount });
        }

        const updatedNotes = await notesService.reindexPendingEmbeddings(env.pendingReindexBatchSize);

        if (updatedNotes.length > 0) {
          logger.info("embeddings.reindex.completed", {
            updatedCount: updatedNotes.length,
            pendingCount,
          });
        }

        for (const note of updatedNotes) {
          await pubSub.publish("NOTE_UPDATED", note);
        }
      } catch (error) {
        const authErrorCode = (error as { code?: string } | null)?.code;

        if (authErrorCode === "28P01") {
          clearInterval(intervalId);
          intervals.delete(intervalId);
          logger.error("embeddings.reindex.disabled", {
            error,
            reason: "database_authentication_failed",
          });
          captureException(error, {
            component: "embeddings_worker",
            reason: "database_authentication_failed",
          });
        } else {
          logger.error("embeddings.reindex.failed", { error });
          captureException(error, { component: "embeddings_worker" });
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
        logger.error("auth.guest_session.cleanup_failed", { error });
        captureException(error, { component: "guest_session_cleanup" });
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
        await oauthService.purgeExpired();
      } catch (error) {
        logger.error("auth.cleanup_failed", { error });
        captureException(error, { component: "auth_cleanup" });
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
      logger.info("backend.shutdown.started", { signal });

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
      .then(async () => {
        await db.$disconnect();
        await flushSentry();
        logger.info("backend.shutdown.completed", { signal });
      })
      .catch(async (error: unknown) => {
        logger.error("backend.shutdown.failed", { error, signal });
        captureException(error, { component: "shutdown", signal });
        await flushSentry();
        process.exitCode = 1;
      });

    void shutdownPromise;
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((error) => {
  logger.error("backend.bootstrap.failed", { error });
  captureException(error, { component: "bootstrap" });
  void flushSentry().finally(() => process.exit(1));
});
