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
import { NotesService } from "./modules/notes/notes.service.js";
import type { Note } from "./modules/notes/notes.types.js";

const GUEST_SESSION_PATH = "/auth/guest-session";

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

  const token = readGuestSessionToken(request);

  if (request.method === "GET") {
    const session = token ? await guestSessions.resolve(token) : null;

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
    const session = await guestSessions.createOrReuse(token);
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
    if (token) {
      await guestSessions.revoke(token);
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
  const notesService = new NotesService(pool, embeddingsService);

  const yoga = createYoga({
    schema: buildSchema({
      publish: async (topic, payload) => {
        await pubSub.publish(topic, payload);
      },
      subscribe: (topic) => pubSub.subscribe(topic),
    }),
    context: async ({ request }) => {
      const guestToken = readGuestSessionToken(request);

      if (guestToken) {
        const guestSession = await guestSessions.resolve(guestToken);

        return {
          notesService,
          sessionId: guestSession?.ownerId ?? null,
          userEmail: null,
        };
      }

      return {
        notesService,
        sessionId: extractLegacySessionId(request),
        userEmail: extractLegacyUserEmail(request),
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

    if (requestUrl.pathname === GUEST_SESSION_PATH) {
      const webRequest = new Request(`http://${request.headers.host || "localhost"}${request.url || "/"}`, {
        method: request.method,
        headers: request.headers as HeadersInit,
      });

      void handleGuestSessionRequest(webRequest, response, guestSessions).catch((error) => {
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
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
