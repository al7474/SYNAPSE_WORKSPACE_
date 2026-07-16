import { createSchema } from "graphql-yoga";
import type { NotesService } from "../modules/notes/notes.service.js";
import type { Note } from "../modules/notes/notes.types.js";

interface GraphQLContext {
  notesService: NotesService;
}

interface NoteUpdatedPubSub {
  publish(topic: "NOTE_UPDATED", payload: Note): Promise<void> | void;
  subscribe(topic: "NOTE_UPDATED"): AsyncIterable<Note>;
}

export function buildSchema(pubSub: NoteUpdatedPubSub) {
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
        listNotes: async (_parent, _args, ctx) => ctx.notesService.listNotes(),
        semanticSearch: async (_parent, args, ctx) => ctx.notesService.semanticSearch(args),
      },
      Mutation: {
        createNote: async (_parent, args, ctx) => {
          const note = await ctx.notesService.createNote(args);
          await pubSub.publish("NOTE_UPDATED", note);
          return note;
        },
        updateNote: async (_parent, args, ctx) => {
          const note = await ctx.notesService.updateNote(args);
          await pubSub.publish("NOTE_UPDATED", note);
          return note;
        },
        deleteNote: async (_parent, args, ctx) => ctx.notesService.deleteNote(args.id),
        reindexPendingEmbeddings: async (_parent, args, ctx) => {
          const updatedNotes = await ctx.notesService.reindexPendingEmbeddings(args.limit ?? 20);

          for (const note of updatedNotes) {
            await pubSub.publish("NOTE_UPDATED", note);
          }

          return updatedNotes.length;
        },
      },
      Subscription: {
        noteUpdated: {
          subscribe: () => pubSub.subscribe("NOTE_UPDATED"),
          resolve: (payload: Note) => payload,
        },
      },
    },
  });
}
