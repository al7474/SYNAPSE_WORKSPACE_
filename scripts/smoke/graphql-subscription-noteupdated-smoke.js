import { EventEmitter, on } from "node:events";
import { buildSchema, graphql, parse, subscribe } from "graphql";
import { DEFAULT_DATABASE_URL, DEFAULT_NOTES_TABLE } from "./lib/constants.js";
import { createConnectedClient, ensureNotesSchema, resetNotesTable } from "./lib/db.js";

const schema = buildSchema(`
  type Note {
    id: ID!
    title: String!
    content: String!
    embeddingPending: Boolean!
  }

  type Query {
    _health: String!
  }

  type Mutation {
    updateNote(id: ID!, content: String!): Note!
  }

  type Subscription {
    noteUpdated: Note!
  }
`);

function createNoteUpdatedIterator(emitter) {
  return (async function* noteUpdatedIterator() {
    for await (const [note] of on(emitter, "noteUpdated")) {
      yield { noteUpdated: note };
    }
  })();
}

function withTimeout(promise, timeoutMs = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Subscription event timeout")), timeoutMs);
    }),
  ]);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const tableName = process.env.SMOKE_NOTES_TABLE || DEFAULT_NOTES_TABLE;
  const client = await createConnectedClient(databaseUrl);
  const emitter = new EventEmitter();

  try {
    await ensureNotesSchema(client, tableName);
    await resetNotesTable(client, tableName);

    const inserted = await client.query(
      `
      INSERT INTO ${tableName} (title, content, embedding_pending)
      VALUES ($1, $2, FALSE)
      RETURNING id, title, content, embedding_pending
      `,
      ["Subscription note", "Initial content"]
    );

    const noteId = String(inserted.rows[0].id);

    const rootValue = {
      _health: () => "ok",
      noteUpdated: () => createNoteUpdatedIterator(emitter),
      updateNote: async ({ id, content }) => {
        const updated = await client.query(
          `
          UPDATE ${tableName}
          SET content = $1,
              updated_at = NOW()
          WHERE id = $2
          RETURNING id, title, content, embedding_pending
          `,
          [content, id]
        );

        if (updated.rowCount === 0) {
          throw new Error("Note not found");
        }

        const row = updated.rows[0];
        const note = {
          id: String(row.id),
          title: row.title,
          content: row.content,
          embeddingPending: row.embedding_pending,
        };

        emitter.emit("noteUpdated", note);
        return note;
      },
    };

    const subscriptionDoc = parse(`
      subscription {
        noteUpdated {
          id
          title
          content
          embeddingPending
        }
      }
    `);

    const subscriptionResult = await subscribe({
      schema,
      document: subscriptionDoc,
      rootValue,
    });

    if (!(Symbol.asyncIterator in subscriptionResult)) {
      throw new Error(`Subscription initialization failed: ${JSON.stringify(subscriptionResult)}`);
    }

    const iterator = subscriptionResult;

    const firstEventPromise = withTimeout(iterator.next(), 10000);

    const firstMutation = await graphql({
      schema,
      rootValue,
      source: `mutation($id: ID!, $content: String!) { updateNote(id: $id, content: $content) { id } }`,
      variableValues: { id: noteId, content: "First realtime update" },
    });

    if (firstMutation.errors?.length) {
      throw new Error(`First update mutation failed: ${JSON.stringify(firstMutation.errors)}`);
    }

    const firstEvent = await firstEventPromise;

    const secondEventPromise = withTimeout(iterator.next(), 10000);

    const secondMutation = await graphql({
      schema,
      rootValue,
      source: `mutation($id: ID!, $content: String!) { updateNote(id: $id, content: $content) { id } }`,
      variableValues: { id: noteId, content: "Second realtime update" },
    });

    if (secondMutation.errors?.length) {
      throw new Error(`Second update mutation failed: ${JSON.stringify(secondMutation.errors)}`);
    }

    const secondEvent = await secondEventPromise;
    await iterator.return();

    const firstContent = firstEvent.value?.data?.noteUpdated?.content;
    const secondContent = secondEvent.value?.data?.noteUpdated?.content;

    const looksCorrect =
      firstContent === "First realtime update" && secondContent === "Second realtime update";

    console.log("Received subscription event #1:", firstEvent.value?.data?.noteUpdated);
    console.log("Received subscription event #2:", secondEvent.value?.data?.noteUpdated);
    console.log("Subscription content order valid:", looksCorrect);

    if (!looksCorrect) {
      throw new Error("noteUpdated subscription did not receive expected updates in order.");
    }

    console.log("Success: noteUpdated subscription smoke test passed.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("noteUpdated subscription smoke test failed:");
  console.error(error);
  process.exit(1);
});
