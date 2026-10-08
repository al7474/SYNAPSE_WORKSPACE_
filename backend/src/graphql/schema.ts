import { createSchema } from "graphql-yoga";
import { GraphQLError } from "graphql";
import type { OwnerMetadata } from "../modules/auth/auth.types.js";
import type { NotesService } from "../modules/notes/notes.service.js";
import type { BoardPermission, DeletedNoteEvent, Note } from "../modules/notes/notes.types.js";
import { logger } from "../observability/logger.js";
import type {
  SubscriptionEventName,
  SubscriptionTicketService,
} from "../modules/subscriptions/subscription-ticket.service.js";

type SubscriptionAuthMode = "ticket" | "session";

interface GraphQLContext {
  notesService: NotesService;
  sessionId: string | null;
  userEmail: string | null;
  emailVerified: boolean;
  ownerMetadata: OwnerMetadata;
  revalidateSession: () => Promise<boolean>;
}

export interface NotePubSub {
  publish(topic: "NOTE_UPDATED", payload: Note): Promise<void> | void;
  publish(topic: "NOTE_DELETED", payload: DeletedNoteEvent): Promise<void> | void;
  subscribe(topic: "NOTE_UPDATED"): AsyncIterable<Note>;
  subscribe(topic: "NOTE_DELETED"): AsyncIterable<DeletedNoteEvent>;
}

export function buildSchema(pubSub: NotePubSub, subscriptionTickets: SubscriptionTicketService) {
  async function* authorizedBoardIterator<T extends { boardId: string }>(
    source: AsyncIterable<T>,
    boardId: string,
    authorize: () => Promise<void>,
    subscription: SubscriptionEventName,
    authMode: SubscriptionAuthMode
  ): AsyncIterable<T> {
    const fields = { subscription, boardId, authMode };

    try {
      for await (const event of source) {
        if (event.boardId !== boardId) {
          continue;
        }

        try {
          await authorize();
        } catch {
          logger.warn("sse.subscription.authorization_revoked", fields);
          return;
        }

        yield event;
      }
    } catch (error) {
      logger.error("sse.subscription.failed", { ...fields, error });
      throw error;
    } finally {
      logger.info("sse.subscription.closed", fields);
    }
  }

  function requireSessionId(ctx: GraphQLContext): string {
    if (!ctx.sessionId) {
      throw new Error("Missing authenticated session cookie.");
    }

    return ctx.sessionId;
  }

  function requireVerifiedEmail(ctx: GraphQLContext): string {
    const sessionId = requireSessionId(ctx);

    if (ctx.ownerMetadata.ownerKind === "user" && !ctx.emailVerified) {
      throw new GraphQLError("Email verification required.", {
        extensions: { code: "EMAIL_VERIFICATION_REQUIRED" },
      });
    }

    return sessionId;
  }

  /** Unverified accounts must not match board invitations by email. */
  function verifiedUserEmail(ctx: GraphQLContext): string | undefined {
    return ctx.emailVerified ? (ctx.userEmail ?? undefined) : undefined;
  }

  function createSubscriptionAuthorizer(
    ctx: GraphQLContext,
    boardId: string,
    event: SubscriptionEventName,
    ticket: string | null | undefined
  ): { authMode: SubscriptionAuthMode; authorize: () => Promise<void> } {
    if (ticket) {
      const grant = subscriptionTickets.redeem(ticket, { boardId, event });

      return {
        authMode: "ticket",
        authorize: async () => {
          if (!(await grant.revalidateSession())) {
            throw new Error("Subscription session is no longer valid.");
          }

          await ctx.notesService.assertShareLinkActive(boardId, grant.shareTokenHash);
        },
      };
    }

    const sessionId = requireSessionId(ctx);

    return {
      authMode: "session",
      authorize: async () => {
        if (!(await ctx.revalidateSession())) {
          throw new Error("Missing authenticated session cookie.");
        }

        await ctx.notesService.assertBoardAccess(
          sessionId,
          verifiedUserEmail(ctx),
          boardId,
          undefined,
          false,
          ctx.ownerMetadata
        );
      },
    };
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
        shareLinkActive: Boolean!
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

      enum SubscriptionEvent {
        noteUpdated
        noteDeleted
      }

      type SubscriptionTicket {
        ticket: String!
        expiresAt: String!
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
        revokeShareLink(boardId: ID!): Boolean!
        createNote(boardId: ID!, shareToken: String, title: String!, content: String!): Note!
        updateNote(boardId: ID!, shareToken: String, id: ID!, title: String, content: String): Note!
        deleteNote(boardId: ID!, shareToken: String, id: ID!): Boolean!
        reindexPendingEmbeddings(boardId: ID!, shareToken: String, limit: Int): Int!
        createSubscriptionTicket(boardId: ID!, shareToken: String!, event: SubscriptionEvent!): SubscriptionTicket!
      }

      type Subscription {
        noteUpdated(boardId: ID!, ticket: String): Note!
        noteDeleted(boardId: ID!, ticket: String): ID!
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
          return ctx.notesService.listBoards(
            sessionId,
            verifiedUserEmail(ctx),
            ctx.ownerMetadata
          );
        },
        listBoardCollaborators: async (_parent, args, ctx) => {
          const sessionId = requireVerifiedEmail(ctx);
          return ctx.notesService.listBoardCollaborators(sessionId, args.boardId, ctx.ownerMetadata);
        },
        accessSharedBoard: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.accessSharedBoard(
            sessionId,
            verifiedUserEmail(ctx),
            args.token,
            ctx.ownerMetadata
          );
        },
        listNotes: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.listNotes({
            ownerId: sessionId,
            userEmail: verifiedUserEmail(ctx),
            ownerMetadata: ctx.ownerMetadata,
            boardId: args.boardId,
            shareToken: args.shareToken ?? undefined,
          });
        },
        semanticSearch: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.semanticSearch({
            ...args,
            ownerId: sessionId,
            userEmail: verifiedUserEmail(ctx),
            ownerMetadata: ctx.ownerMetadata,
            shareToken: args.shareToken ?? undefined,
          });
        },
      },
      Mutation: {
        createBoard: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.createBoard(sessionId, args.name, ctx.ownerMetadata);
        },
        updateBoard: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.updateBoard(sessionId, args.id, args.name, ctx.ownerMetadata);
        },
        deleteBoard: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          return ctx.notesService.deleteBoard(sessionId, args.id, ctx.ownerMetadata);
        },
        setBoardCollaborator: async (_parent, args, ctx) => {
          const sessionId = requireVerifiedEmail(ctx);
          return ctx.notesService.setBoardCollaborator(
            sessionId,
            args.boardId,
            args.email,
            args.permission as BoardPermission,
            ctx.ownerMetadata
          );
        },
        removeBoardCollaborator: async (_parent, args, ctx) => {
          const sessionId = requireVerifiedEmail(ctx);
          return ctx.notesService.removeBoardCollaborator(
            sessionId,
            args.boardId,
            args.email,
            ctx.ownerMetadata
          );
        },
        createShareLink: async (_parent, args, ctx) => {
          const sessionId = requireVerifiedEmail(ctx);
          return ctx.notesService.createShareLink(
            sessionId,
            args.boardId,
            args.permission as BoardPermission,
            ctx.ownerMetadata
          );
        },
        revokeShareLink: async (_parent, args, ctx) => {
          const sessionId = requireVerifiedEmail(ctx);
          return ctx.notesService.revokeShareLink(sessionId, args.boardId, ctx.ownerMetadata);
        },
        createNote: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          const note = await ctx.notesService.createNote({
            ...args,
            ownerId: sessionId,
            userEmail: verifiedUserEmail(ctx),
            ownerMetadata: ctx.ownerMetadata,
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
            userEmail: verifiedUserEmail(ctx),
            ownerMetadata: ctx.ownerMetadata,
            shareToken: args.shareToken ?? undefined,
          });
          await pubSub.publish("NOTE_UPDATED", note);
          return note;
        },
        deleteNote: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          const deletedNote = await ctx.notesService.deleteNoteWithMetadata(
            sessionId,
            verifiedUserEmail(ctx),
            args.boardId,
            args.shareToken ?? undefined,
            args.id,
            ctx.ownerMetadata
          );

          if (deletedNote) {
            await pubSub.publish("NOTE_DELETED", deletedNote);
          }

          return Boolean(deletedNote);
        },
        createSubscriptionTicket: async (_parent, args, ctx) => {
          requireSessionId(ctx);
          const shareTokenHash = await ctx.notesService.resolveShareTokenHash(
            args.boardId,
            args.shareToken
          );

          return subscriptionTickets.issue({
            boardId: args.boardId,
            event: args.event as SubscriptionEventName,
            shareTokenHash,
            revalidateSession: ctx.revalidateSession,
          });
        },
        reindexPendingEmbeddings: async (_parent, args, ctx) => {
          const sessionId = requireSessionId(ctx);
          const updatedNotes = await ctx.notesService.reindexPendingEmbeddingsForBoard(
            sessionId,
            verifiedUserEmail(ctx),
            args.boardId,
            args.shareToken ?? undefined,
            args.limit ?? 20,
            ctx.ownerMetadata
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
            const { authMode, authorize } = createSubscriptionAuthorizer(
              ctx,
              args.boardId,
              "noteUpdated",
              args.ticket
            );

            await authorize();
            logger.info("sse.subscription.opened", {
              subscription: "noteUpdated",
              boardId: args.boardId,
              authMode,
            });
            return authorizedBoardIterator(
              pubSub.subscribe("NOTE_UPDATED"),
              args.boardId,
              authorize,
              "noteUpdated",
              authMode
            );
          },
          resolve: (payload: Note) => payload,
        },
        noteDeleted: {
          subscribe: async (_parent, args, ctx) => {
            const { authMode, authorize } = createSubscriptionAuthorizer(
              ctx,
              args.boardId,
              "noteDeleted",
              args.ticket
            );

            await authorize();
            logger.info("sse.subscription.opened", {
              subscription: "noteDeleted",
              boardId: args.boardId,
              authMode,
            });
            return authorizedBoardIterator(
              pubSub.subscribe("NOTE_DELETED"),
              args.boardId,
              authorize,
              "noteDeleted",
              authMode
            );
          },
          resolve: (payload: DeletedNoteEvent) => payload.id,
        },
      },
    },
  });
}