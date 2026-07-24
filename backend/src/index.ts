import { createServer, type ServerResponse } from "node:http";
import { createPubSub, createYoga } from "graphql-yoga";
import { Pool } from "pg";
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
import { NotesService } from "./modules/notes/notes.service.js";
import type { Note } from "./modules/notes/notes.types.js";

const GUEST_SESSION_PATH = "/auth/guest-session";
const AUTH_PATH_SET = new Set<string>(Object.values(AUTH_PATHS));

function extractLegacySessionId(request: Request): string | null {
  const headerValue = request.headers.get("x-session-id")?.trim();
  const url = new URL(request.url);
  const queryValue = url.searchParams.get("sessionId")?.trim();
  const candidate = headerValue || queryValue || null;

  if (!candidate || candidate.startsWith("guest_")) {
    return null;
  }

  return candidate;
}

function extractLegacyUserEmail(request: Request): string | null {
  const headerValue = request.headers.get("x-user-email")?.trim().toLowerCase();

  if (headerValue) {
    return headerValue;
  }

  const url = new URL(request.url);
  const queryValue = url.searchParams.get("userEmail")?.trim().toLowerCase();

  if (queryValue) {
    return queryValue;
  }

  return null;
}

function setAuthCorsHeaders(request: Request, response: ServerResponse): void {
  const requestOrigin = request.headers.get("origin");

  if (!requestOrigin || requestOrigin === env.frontendOrigin) {
    response.setHeader("Access-Control-Allow-Origin", env.frontendOrigin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("Vary", "Origin");
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function handleGuestSessionRequest(
  request: Request,
  response: ServerResponse,
  guestSessions: GuestSessionService
): Promise<void> {
  setAuthCorsHeaders(request, response);

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  const guestSessionCookieValue = readGuestSessionToken(request);

  if (request.method === "GET") {
    const session = guestSessionCookieValue
      ? await guestSessions.resolve(guestSessionCookieValue)
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
    const session = await guestSessions.createOrReuse(guestSessionCookieValue);
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
      await guestSessions.revoke(guestSessionCookieValue);
    }

    response.setHeader("Set-Cookie", clearGuestSessionCookie(env.isProduction));
    sendJson(response, 200, { deleted: true });
    return;
  }

  response.setHeader("Allow", "GET, POST, DELETE, OPTIONS");
  sendJson(response, 405, { error: "Method not allowed" });
}

async function bootstrap() {
  const pool = new Pool({ connectionString: env.databaseUrl });
  const pubSub = createPubSub<{ NOTE_UPDATED: [Note] }>();
  const embeddingsService = new OpenRouterEmbeddingsService(
    env.openRouterApiKey,
    env.embeddingModel,
    env.embeddingDimension
  );
  const guestSessions = new GuestSessionService(pool, env.guestSessionTtlMs);
  const authService = new AuthService(pool, {
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
  const notesService = new NotesService(pool, embeddingsService);

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
          ownerMetadata: authSession
            ? { ownerKind: "user", ownerUserId: authSession.user.id }
            : { ownerKind: "legacy" },
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
          userEmail: null,
          ownerMetadata,
        };
      }

      const ownerMetadata: OwnerMetadata = { ownerKind: "legacy" };

      return {
        notesService,
        sessionId: extractLegacySessionId(request),
        userEmail: extractLegacyUserEmail(request),
        ownerMetadata,
      };
    },
    cors: {
      origin: env.frontendOrigin,
      credentials: true,
      allowedHeaders: ["Content-Type", "x-session-id", "x-user-email"],
    },
    graphiql: !env.isProduction,
  });

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

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

      const handler = requestUrl.pathname === GUEST_SESSION_PATH
        ? handleGuestSessionRequest(webRequest, response, guestSessions)
        : handleAuthRequest(webRequest, response, {
            authService,
            emailService: authEmailService,
            isProduction: env.isProduction,
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
      } catch (error) {
        console.error("Authentication cleanup error:", error);
      } finally {
        running = false;
      }
    }, env.authCleanupIntervalMs);

    intervalId.unref();
  }
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
