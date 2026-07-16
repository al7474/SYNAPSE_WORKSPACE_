import { buildSchema, graphql } from "graphql";
import { DEFAULT_DATABASE_URL, DEFAULT_NOTES_TABLE } from "./lib/constants.js";
import { createConnectedClient, ensureNotesSchema, resetNotesTable } from "./lib/db.js";
import { fetchEmbedding, toPgvectorLiteral } from "./lib/openrouter.js";

const schema = buildSchema(`
  type Note {
    id: ID!
    title: String!
    content: String!
    embeddingPending: Boolean!
  }

  type Query {
    listNotes: [Note!]!
  }

  type Mutation {
    createNote(title: String!, content: String!): Note!
    updateNote(id: ID!, title: String, content: String): Note!
  }
`);

async function main() {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const tableName = process.env.SMOKE_NOTES_TABLE || DEFAULT_NOTES_TABLE;
  const client = await createConnectedClient(databaseUrl);

  try {
    await ensureNotesSchema(client, tableName);
    await resetNotesTable(client, tableName);

    const rootValue = {
      createNote: async ({ title, content }) => {
        let embedding = null;
        let embeddingPending = false;

        try {
          embedding = await fetchEmbedding({ input: content });
        } catch {
          embeddingPending = true;
        }

        const inserted = await client.query(
          `
          INSERT INTO ${tableName} (title, content, embedding, embedding_pending)
          VALUES ($1, $2, $3::vector, $4)
          RETURNING id, title, content, embedding_pending
          `,
          [title, content, embedding ? toPgvectorLiteral(embedding) : null, embeddingPending]
        );

        const row = inserted.rows[0];
        return {
          id: String(row.id),
          title: row.title,
          content: row.content,
          embeddingPending: row.embedding_pending,
        };
      },

      updateNote: async ({ id, title, content }) => {
        const current = await client.query(`SELECT * FROM ${tableName} WHERE id = $1`, [id]);

        if (current.rowCount === 0) {
          throw new Error("Note not found");
        }

        const existing = current.rows[0];
        const nextTitle = title ?? existing.title;
        const nextContent = content ?? existing.content;

        let nextEmbedding = existing.embedding;
        let embeddingPending = existing.embedding_pending;

        if (content && content !== existing.content) {
          try {
            const freshEmbedding = await fetchEmbedding({ input: nextContent });
            nextEmbedding = toPgvectorLiteral(freshEmbedding);
            embeddingPending = false;
          } catch {
            nextEmbedding = null;
            embeddingPending = true;
          }
        }

        const updated = await client.query(
          `
          UPDATE ${tableName}
          SET title = $1,
              content = $2,
              embedding = $3::vector,
              embedding_pending = $4,
              updated_at = NOW()
          WHERE id = $5
          RETURNING id, title, content, embedding_pending
          `,
          [nextTitle, nextContent, nextEmbedding, embeddingPending, id]
        );

        const row = updated.rows[0];
        return {
          id: String(row.id),
          title: row.title,
          content: row.content,
          embeddingPending: row.embedding_pending,
        };
      },

      listNotes: async () => {
        const result = await client.query(
          `SELECT id, title, content, embedding_pending FROM ${tableName} ORDER BY id ASC`
        );

        return result.rows.map((row) => ({
          id: String(row.id),
          title: row.title,
          content: row.content,
          embeddingPending: row.embedding_pending,
        }));
      },
    };

    const createRes = await graphql({
      schema,
      source: `
        mutation {
          createNote(title: "GraphQL Note", content: "Intro to docker compose and containers") {
            id
            title
            content
            embeddingPending
          }
        }
      `,
      rootValue,
    });

    if (createRes.errors?.length) {
      throw new Error(`createNote failed: ${JSON.stringify(createRes.errors)}`);
    }

    const created = createRes.data.createNote;

    const updateRes = await graphql({
      schema,
      source: `
        mutation($id: ID!) {
          updateNote(id: $id, content: "Updated content about postgres indexing") {
            id
            title
            content
            embeddingPending
          }
        }
      `,
      rootValue,
      variableValues: { id: created.id },
    });

    if (updateRes.errors?.length) {
      throw new Error(`updateNote failed: ${JSON.stringify(updateRes.errors)}`);
    }

    const listRes = await graphql({
      schema,
      source: `
        query {
          listNotes {
            id
            title
            content
            embeddingPending
          }
        }
      `,
      rootValue,
    });

    if (listRes.errors?.length) {
      throw new Error(`listNotes failed: ${JSON.stringify(listRes.errors)}`);
    }

    if (!Array.isArray(listRes.data.listNotes) || listRes.data.listNotes.length === 0) {
      throw new Error("listNotes returned no data");
    }

    console.log("createNote result:", createRes.data.createNote);
    console.log("updateNote result:", updateRes.data.updateNote);
    console.log("listNotes result:", listRes.data.listNotes);
    console.log("Success: GraphQL base smoke test passed.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("GraphQL base smoke test failed:");
  console.error(error);
  process.exit(1);
});
