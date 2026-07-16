import { createServer } from "node:http";
import { createPubSub, createYoga } from "graphql-yoga";
import { Pool } from "pg";
import { env } from "./config/env.js";
import { buildSchema } from "./graphql/schema.js";
import { OpenRouterEmbeddingsService } from "./modules/embeddings/openrouter-embeddings.service.js";
import { NotesService } from "./modules/notes/notes.service.js";
import type { Note } from "./modules/notes/notes.types.js";

async function bootstrap() {
  const pool = new Pool({ connectionString: env.databaseUrl });
  const pubSub = createPubSub<{ NOTE_UPDATED: [Note] }>();
  const embeddingsService = new OpenRouterEmbeddingsService(
    env.openRouterApiKey,
    env.embeddingModel
  );
  const notesService = new NotesService(pool, embeddingsService);

  const yoga = createYoga({
    schema: buildSchema({
      publish: async (topic, payload) => {
        await pubSub.publish(topic, payload);
      },
      subscribe: (topic) => pubSub.subscribe(topic),
    }),
    context: () => ({ notesService }),
    graphiql: true,
  });

  const server = createServer(yoga);

  server.listen(env.port, () => {
    console.log(`Backend running on http://localhost:${env.port}/graphql`);
  });

  if (env.pendingReindexIntervalMs > 0) {
    let running = false;

    setInterval(async () => {
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
        console.error("Pending reindex worker error:", error);
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
