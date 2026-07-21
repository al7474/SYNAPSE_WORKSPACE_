import { createServer } from "node:http";
import { createPubSub, createYoga } from "graphql-yoga";
import { Pool } from "pg";
import { env } from "./config/env.js";
import { buildSchema } from "./graphql/schema.js";
import { OpenRouterEmbeddingsService } from "./modules/embeddings/openrouter-embeddings.service.js";
import { NotesService } from "./modules/notes/notes.service.js";
import type { Note } from "./modules/notes/notes.types.js";

function extractSessionId(request: Request): string | null {
  const headerValue = request.headers.get("x-session-id")?.trim();

  if (headerValue) {
    return headerValue;
  }

  const url = new URL(request.url);
  const queryValue = url.searchParams.get("sessionId")?.trim();

  if (queryValue) {
    return queryValue;
  }

  return null;
}

function extractUserEmail(request: Request): string | null {
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

async function bootstrap() {
  const pool = new Pool({ connectionString: env.databaseUrl });
  const pubSub = createPubSub<{ NOTE_UPDATED: [Note] }>();
  const embeddingsService = new OpenRouterEmbeddingsService(
    env.openRouterApiKey,
    env.embeddingModel,
    env.embeddingDimension
  );
  const notesService = new NotesService(pool, embeddingsService);

  const yoga = createYoga({
    schema: buildSchema({
      publish: async (topic, payload) => {
        await pubSub.publish(topic, payload);
      },
      subscribe: (topic) => pubSub.subscribe(topic),
    }),
    context: ({ request }) => ({
      notesService,
      sessionId: extractSessionId(request),
      userEmail: extractUserEmail(request),
    }),
    graphiql: true,
  });

  const server = createServer(yoga);

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
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
