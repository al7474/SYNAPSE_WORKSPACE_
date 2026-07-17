import { createSchema } from "graphql-yoga";
import type { NotesService } from "../modules/notes/notes.service.js";
import type { Note } from "../modules/notes/notes.types.js";

interface GraphQLContext {
  notesService: NotesService;
  sessionId: string | null;
}

interface NoteUpdatedPubSub {
  publish(topic: "NOTE_UPDATED", payload: Note): Promise<void> | void;
  subscribe(topic: "NOTE_UPDATED"): AsyncIterable<Note>;
}

export function buildSchema(pubSub: NoteUpdatedPubSub) {
  async function* ownerScopedIterator(source: AsyncIterable<Note>, ownerId: string): AsyncIterable<Note> {
    for await (const event of source) {
      if (event.ownerId === ownerId) {
        yield event;
      }
    }
  }

  function requireSessionId(ctx: GraphQLContext): string {
    if (!ctx.sessionId) {
      throw new Error("Missing session id. Send x-session-id header.");
    }

    return ctx.sessionId;
  }

  return createSchema<GraphQLContext>({
    typeDefs: /* GraphQL */ `
      type Note {
        id: ID!
        title: String!
        content: String!
        embeddingPending: Boolean!
        createdAt: String!
        updatedAt: String!
        semanticScore: Float
      }

      type Query {
        listNotes: [Note!]!
        semanticSearch(query: String!, limit: Int, minSimilarity: Float): [Note!]!
      }

      type Mutation {
        createNote(title: String!, content: String!): Note!
        updateNote(id: ID!, title: String, content: String): Note!
        deleteNote(id: ID!): Boolean!
        reindexPendingEmbeddings(limit: Int): Int!
      }

      type Subscription {
        noteUpdated: Note!
      }
    `,
    resolvers: {
      Query: {
        listNotes: async (_parent, _args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.listNotes(sessionId);
        },
        semanticSearch: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.semanticSearch({ ...args, ownerId: sessionId });
        },
      },
      Mutation: {
        createNote: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          const note = await ctx.notesService.createNote({ ...args, ownerId: sessionId });
          await pubSub.publish("NOTE_UPDATED", note);
          return note;
        },
        updateNote: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          const note = await ctx.notesService.updateNote({ ...args, ownerId: sessionId });
          await pubSub.publish("NOTE_UPDATED", note);
          return note;
        },
        deleteNote: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.deleteNote(sessionId, args.id);
        },
        reindexPendingEmbeddings: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          const updatedNotes = await ctx.notesService.reindexPendingEmbeddingsForOwner(
            sessionId,
            args.limit ?? 20
          );

          for (const note of updatedNotes) {
            await pubSub.publish("NOTE_UPDATED", note);
          }

          return updatedNotes.length;
        },
      },
      Subscription: {
        noteUpdated: {
          subscribe: (_parent, _args, ctx) => {
            const sessionId = requireSessionId(ctx);
            return ownerScopedIterator(pubSub.subscribe("NOTE_UPDATED"), sessionId);
          },
          resolve: (payload: Note) => payload,
        },
      },
    },
  });
}
