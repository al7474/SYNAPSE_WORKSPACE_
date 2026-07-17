import { createSchema } from "graphql-yoga";
import type { NotesService } from "../modules/notes/notes.service.js";
import type { BoardPermission, Note } from "../modules/notes/notes.types.js";

interface GraphQLContext {
  notesService: NotesService;
  sessionId: string | null;
  userEmail: string | null;
}

interface NoteUpdatedPubSub {
  publish(topic: "NOTE_UPDATED", payload: Note): Promise<void> | void;
  subscribe(topic: "NOTE_UPDATED"): AsyncIterable<Note>;
}

export function buildSchema(pubSub: NoteUpdatedPubSub) {
  async function* boardScopedIterator(source: AsyncIterable<Note>, boardId: string): AsyncIterable<Note> {
    for await (const event of source) {
      if (event.boardId === boardId) {
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
        boardId: ID!
        title: String!
        content: String!
        embeddingPending: Boolean!
        createdAt: String!
        updatedAt: String!
        semanticScore: Float
      }

      enum BoardPermission {
        view
        edit
      }

      type Board {
        id: ID!
        ownerId: String!
        name: String!
        shareToken: String
        sharePermission: BoardPermission!
        createdAt: String!
        updatedAt: String!
      }

      type SharedBoardAccess {
        board: Board!
        permission: BoardPermission!
      }

      type BoardCollaborator {
        boardId: ID!
        email: String!
        permission: BoardPermission!
        createdAt: String!
        updatedAt: String!
      }

      type Query {
        listBoards: [Board!]!
        listBoardCollaborators(boardId: ID!): [BoardCollaborator!]!
        accessSharedBoard(token: String!): SharedBoardAccess!
        listNotes(boardId: ID!, shareToken: String): [Note!]!
        semanticSearch(boardId: ID!, shareToken: String, query: String!, limit: Int, minSimilarity: Float): [Note!]!
      }

      type Mutation {
        createBoard(name: String!): Board!
        updateBoard(id: ID!, name: String!): Board!
        deleteBoard(id: ID!): Boolean!
        setBoardCollaborator(boardId: ID!, email: String!, permission: BoardPermission!): BoardCollaborator!
        removeBoardCollaborator(boardId: ID!, email: String!): Boolean!
        createShareLink(boardId: ID!, permission: BoardPermission!): String!
        createNote(boardId: ID!, shareToken: String, title: String!, content: String!): Note!
        updateNote(boardId: ID!, shareToken: String, id: ID!, title: String, content: String): Note!
        deleteNote(boardId: ID!, shareToken: String, id: ID!): Boolean!
        reindexPendingEmbeddings(boardId: ID!, shareToken: String, limit: Int): Int!
      }

      type Subscription {
        noteUpdated(boardId: ID!, shareToken: String): Note!
      }
    `,
    resolvers: {
      BoardPermission: {
        view: "view",
        edit: "edit",
      },
      Query: {
        listBoards: async (_parent, _args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.listBoards(sessionId, ctx.userEmail ?? undefined);
        },
        listBoardCollaborators: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.listBoardCollaborators(sessionId, args.boardId);
        },
        accessSharedBoard: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.accessSharedBoard(sessionId, ctx.userEmail ?? undefined, args.token);
        },
        listNotes: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.listNotes({
            ownerId: sessionId,
            userEmail: ctx.userEmail ?? undefined,
            boardId: args.boardId,
            shareToken: args.shareToken ?? undefined,
          });
        },
        semanticSearch: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.semanticSearch({
            ...args,
            ownerId: sessionId,
            userEmail: ctx.userEmail ?? undefined,
            shareToken: args.shareToken ?? undefined,
          });
        },
      },
      Mutation: {
        createBoard: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.createBoard(sessionId, args.name);
        },
        updateBoard: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.updateBoard(sessionId, args.id, args.name);
        },
        deleteBoard: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.deleteBoard(sessionId, args.id);
        },
        setBoardCollaborator: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.setBoardCollaborator(
            sessionId,
            args.boardId,
            args.email,
            args.permission as BoardPermission
          );
        },
        removeBoardCollaborator: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.removeBoardCollaborator(sessionId, args.boardId, args.email);
        },
        createShareLink: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.createShareLink(
            sessionId,
            args.boardId,
            args.permission as BoardPermission
          );
        },
        createNote: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          const note = await ctx.notesService.createNote({
            ...args,
            ownerId: sessionId,
            userEmail: ctx.userEmail ?? undefined,
            shareToken: args.shareToken ?? undefined,
          });
          await pubSub.publish("NOTE_UPDATED", note);
          return note;
        },
        updateNote: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          const note = await ctx.notesService.updateNote({
            ...args,
            ownerId: sessionId,
            userEmail: ctx.userEmail ?? undefined,
            shareToken: args.shareToken ?? undefined,
          });
          await pubSub.publish("NOTE_UPDATED", note);
          return note;
        },
        deleteNote: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.deleteNote(
            sessionId,
            ctx.userEmail ?? undefined,
            args.boardId,
            args.shareToken ?? undefined,
            args.id
          );
        },
        reindexPendingEmbeddings: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          const updatedNotes = await ctx.notesService.reindexPendingEmbeddingsForBoard(
            sessionId,
            ctx.userEmail ?? undefined,
            args.boardId,
            args.shareToken ?? undefined,
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
          subscribe: async (_parent, args, ctx) => {
            const sessionId = requireSessionId(ctx);
            await ctx.notesService.listNotes({
              ownerId: sessionId,
              userEmail: ctx.userEmail ?? undefined,
              boardId: args.boardId,
              shareToken: args.shareToken ?? undefined,
            });
            return boardScopedIterator(pubSub.subscribe("NOTE_UPDATED"), args.boardId);
          },
          resolve: (payload: Note) => payload,
        },
      },
    },
  });
}
