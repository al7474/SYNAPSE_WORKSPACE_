import { EventEmitter, on } from "node:events";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  execute,
  parse,
  subscribe as subscribeGraphql,
  validate,
  type ExecutionResult,
  type GraphQLSchema,
} from "graphql";
import { buildSchema, type NotePubSub } from "../graphql/schema.js";
import type { OwnerMetadata } from "../modules/auth/auth.types.js";
import { OpenRouterEmbeddingsService } from "../modules/embeddings/openrouter-embeddings.service.js";
import { NotesService } from "../modules/notes/notes.service.js";
import type { Note } from "../modules/notes/notes.types.js";
import { SubscriptionTicketService } from "../modules/subscriptions/subscription-ticket.service.js";

const databaseUrl = process.env.DATABASE_URL;
const embedding = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));
const runId = `${process.pid}-${Date.now()}`;
const ACCESS_DENIED_MESSAGE = "Access denied for this board";
const INVALID_TICKET_MESSAGE = "Invalid or expired subscription ticket";

interface TestUser {
  id: string;
  email: string;
}

interface TestContext {
  notesService: NotesService;
  sessionId: string | null;
  userEmail: string | null;
  emailVerified: boolean;
  ownerMetadata: OwnerMetadata;
  revalidateSession: () => Promise<boolean>;
}

interface TicketPayload {
  createSubscriptionTicket: { ticket: string; expiresAt: string };
}

const createTicketMutation = /* GraphQL */ `
  mutation CreateSubscriptionTicket($boardId: ID!, $shareToken: String!, $event: SubscriptionEvent!) {
    createSubscriptionTicket(boardId: $boardId, shareToken: $shareToken, event: $event) {
      ticket
      expiresAt
    }
  }
`;

const noteUpdatedSubscription = /* GraphQL */ `
  subscription NoteUpdated($boardId: ID!, $ticket: String) {
    noteUpdated(boardId: $boardId, ticket: $ticket) {
      id
    }
  }
`;

const noteDeletedSubscription = /* GraphQL */ `
  subscription NoteDeleted($boardId: ID!, $ticket: String) {
    noteDeleted(boardId: $boardId, ticket: $ticket)
  }
`;

const legacyShareTokenSubscription = /* GraphQL */ `
  subscription NoteUpdated($boardId: ID!, $shareToken: String) {
    noteUpdated(boardId: $boardId, shareToken: $shareToken) {
      id
    }
  }
`;

let db: PrismaClient;
let notes: NotesService;
let schema: GraphQLSchema;
let pubSub: NotePubSub;
let owner: TestUser;
let collaborator: TestUser;
let outsider: TestUser;

const createdUserIds: bigint[] = [];

function cloneData(data: unknown): unknown {
  return structuredClone(data);
}

function createEventPubSub(): NotePubSub {
  const emitter = new EventEmitter();

  async function* listen(topic: string) {
    for await (const [payload] of on(emitter, topic)) {
      yield payload;
    }
  }

  return {
    publish: async (topic: string, payload: unknown) => {
      emitter.emit(topic, payload);
    },
    subscribe: (topic: string) => listen(topic),
  } as NotePubSub;
}

function createNotesService(): NotesService {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ data: [{ embedding }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const embeddingsService = new OpenRouterEmbeddingsService(
    "ci-mock-openrouter-key",
    "ci-mock-embedding-model",
    embedding.length,
    { fetchImpl, retryDelayMs: 0 }
  );

  return new NotesService(db, embeddingsService);
}

async function createUser(label: string): Promise<TestUser> {
  const row = await db.user.create({
    data: {
      email: `subscription-${label}-${runId}@example.test`,
      name: `Subscription ${label}`,
      passwordHash: "ci-integration-not-used-for-login",
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(row.id);
  return { id: String(row.id), email: row.email };
}

function ownerMetadataFor(user: TestUser): OwnerMetadata {
  return { ownerKind: "user", ownerUserId: user.id };
}

async function createBoardOwnedBy(user: TestUser, name: string): Promise<string> {
  const board = await notes.createBoard(user.id, name, ownerMetadataFor(user));
  return board.id;
}

function accountContext(user: TestUser): TestContext {
  return {
    notesService: notes,
    sessionId: user.id,
    userEmail: user.email,
    emailVerified: true,
    ownerMetadata: ownerMetadataFor(user),
    revalidateSession: async () => true,
  };
}

function visitorContext(revalidateSession: () => Promise<boolean> = async () => true): TestContext {
  return {
    notesService: notes,
    sessionId: `visitor-${runId}`,
    userEmail: null,
    emailVerified: false,
    ownerMetadata: { ownerKind: "legacy" },
    revalidateSession,
  };
}

async function runGraphql(
  contextValue: TestContext,
  source: string,
  variableValues: Record<string, unknown>
) {
  return execute({ schema, document: parse(source), contextValue, variableValues });
}

async function issueTicket(
  boardId: string,
  shareToken: string,
  event: "noteUpdated" | "noteDeleted",
  contextValue: TestContext = visitorContext()
): Promise<string> {
  const result = await runGraphql(contextValue, createTicketMutation, { boardId, shareToken, event });
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));

  return (cloneData(result.data) as TicketPayload).createSubscriptionTicket.ticket;
}

async function subscribeOrFail(
  contextValue: TestContext,
  source: string,
  variableValues: Record<string, unknown>
): Promise<AsyncGenerator<ExecutionResult, void, void>> {
  const result = await subscribeGraphql({
    schema,
    document: parse(source),
    contextValue,
    variableValues,
  });

  if (!(Symbol.asyncIterator in result)) {
    throw new Error(`Subscription failed: ${JSON.stringify(result.errors)}`);
  }

  return result;
}

function subscriptionErrorMessages(
  result: Awaited<ReturnType<typeof subscribeGraphql>>
): string[] {
  if (Symbol.asyncIterator in result) {
    return [];
  }

  return (result.errors ?? []).map((error) => error.message);
}

async function receiveAfter(
  iterator: AsyncGenerator<ExecutionResult, void, void>,
  publish: () => Promise<void> | void
): Promise<IteratorResult<ExecutionResult, void>> {
  const pending = iterator.next();
  await new Promise((resolve) => setImmediate(resolve));
  await publish();
  return pending;
}

function noteIdFromEvent(result: IteratorResult<ExecutionResult, void>): string | undefined {
  if (result.done) {
    return undefined;
  }

  return (cloneData(result.value.data) as { noteUpdated?: { id: string } } | null)?.noteUpdated?.id;
}

before(async () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for integration tests");
  }

  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await db.$connect();

  notes = createNotesService();
  pubSub = createEventPubSub();
  schema = buildSchema(pubSub, new SubscriptionTicketService({ ttlMs: 45_000, maxPendingTickets: 100 }));
  owner = await createUser("owner");
  collaborator = await createUser("collaborator");
  outsider = await createUser("outsider");
});

after(async () => {
  await db?.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await db?.$disconnect();
});

describe("share link subscription tickets", () => {
  test("issues tickets only for a valid share link and only with a session", async () => {
    const boardId = await createBoardOwnedBy(owner, "Ticket issuance board");
    const token = await notes.createShareLink(owner.id, boardId, "view", ownerMetadataFor(owner));

    const issued = await runGraphql(visitorContext(), createTicketMutation, {
      boardId,
      shareToken: token,
      event: "noteUpdated",
    });
    const payload = (cloneData(issued.data) as TicketPayload).createSubscriptionTicket;

    assert.equal(issued.errors, undefined);
    assert.match(payload.ticket, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(Date.parse(payload.expiresAt) > Date.now());

    const denied = await runGraphql(visitorContext(), createTicketMutation, {
      boardId,
      shareToken: "not-the-share-token",
      event: "noteUpdated",
    });
    assert.equal(denied.errors?.[0]?.message, ACCESS_DENIED_MESSAGE);

    const anonymous = await runGraphql({ ...visitorContext(), sessionId: null }, createTicketMutation, {
      boardId,
      shareToken: token,
      event: "noteUpdated",
    });
    assert.equal(anonymous.errors?.[0]?.message, "Missing authenticated session cookie.");
  });

  test("streams events through a ticket and stops once the share link is revoked", async () => {
    const boardId = await createBoardOwnedBy(owner, "Revocation board");
    const note = await notes.createNote({
      ownerId: owner.id,
      ownerMetadata: ownerMetadataFor(owner),
      boardId,
      title: "Live note",
      content: "Initial content",
    });
    const token = await notes.createShareLink(owner.id, boardId, "view", ownerMetadataFor(owner));
    const ticket = await issueTicket(boardId, token, "noteUpdated");
    const iterator = await subscribeOrFail(visitorContext(), noteUpdatedSubscription, { boardId, ticket });

    const updated: Note = await notes.updateNote({
      ownerId: owner.id,
      ownerMetadata: ownerMetadataFor(owner),
      boardId,
      id: note.id,
      content: "Live update",
    });
    const firstEvent = await receiveAfter(iterator, () => pubSub.publish("NOTE_UPDATED", updated));

    assert.equal(noteIdFromEvent(firstEvent), note.id);

    await notes.revokeShareLink(owner.id, boardId, ownerMetadataFor(owner));
    const afterRevoke = await receiveAfter(iterator, () => pubSub.publish("NOTE_UPDATED", updated));

    assert.equal(afterRevoke.done, true);
  });

  test("tickets are single-use", async () => {
    const boardId = await createBoardOwnedBy(owner, "Single-use board");
    const token = await notes.createShareLink(owner.id, boardId, "view", ownerMetadataFor(owner));
    const ticket = await issueTicket(boardId, token, "noteUpdated");
    const iterator = await subscribeOrFail(visitorContext(), noteUpdatedSubscription, { boardId, ticket });

    const replay = await subscribeGraphql({
      schema,
      document: parse(noteUpdatedSubscription),
      contextValue: visitorContext(),
      variableValues: { boardId, ticket },
    });

    assert.deepEqual(subscriptionErrorMessages(replay), [INVALID_TICKET_MESSAGE]);
    await iterator.return();
  });

  test("a ticket issued for noteUpdated cannot open noteDeleted", async () => {
    const boardId = await createBoardOwnedBy(owner, "Event binding board");
    const token = await notes.createShareLink(owner.id, boardId, "view", ownerMetadataFor(owner));
    const ticket = await issueTicket(boardId, token, "noteUpdated");

    const attempt = await subscribeGraphql({
      schema,
      document: parse(noteDeletedSubscription),
      contextValue: visitorContext(),
      variableValues: { boardId, ticket },
    });

    assert.deepEqual(subscriptionErrorMessages(attempt), [INVALID_TICKET_MESSAGE]);
  });

  test("streams deletions through a noteDeleted ticket", async () => {
    const boardId = await createBoardOwnedBy(owner, "Deletion board");
    const note = await notes.createNote({
      ownerId: owner.id,
      ownerMetadata: ownerMetadataFor(owner),
      boardId,
      title: "Doomed note",
      content: "Soon deleted",
    });
    const token = await notes.createShareLink(owner.id, boardId, "view", ownerMetadataFor(owner));
    const ticket = await issueTicket(boardId, token, "noteDeleted");
    const iterator = await subscribeOrFail(visitorContext(), noteDeletedSubscription, { boardId, ticket });

    const event = await receiveAfter(iterator, () =>
      pubSub.publish("NOTE_DELETED", { id: note.id, boardId })
    );

    assert.equal(event.done, false);
    assert.equal((cloneData(event.value?.data) as { noteDeleted: string }).noteDeleted, note.id);
    await iterator.return();
  });

  test("ticket subscriptions stop when the session that issued the ticket is no longer valid", async () => {
    const boardId = await createBoardOwnedBy(owner, "Session revalidation board");
    const note = await notes.createNote({
      ownerId: owner.id,
      ownerMetadata: ownerMetadataFor(owner),
      boardId,
      title: "Watched note",
      content: "Initial",
    });
    const token = await notes.createShareLink(owner.id, boardId, "view", ownerMetadataFor(owner));
    let sessionActive = true;
    const visitor = visitorContext(async () => sessionActive);
    const ticket = await issueTicket(boardId, token, "noteUpdated", visitor);
    const iterator = await subscribeOrFail(visitor, noteUpdatedSubscription, { boardId, ticket });
    const updated = await notes.updateNote({
      ownerId: owner.id,
      ownerMetadata: ownerMetadataFor(owner),
      boardId,
      id: note.id,
      content: "Still watched",
    });

    assert.equal(noteIdFromEvent(await receiveAfter(iterator, () => pubSub.publish("NOTE_UPDATED", updated))), note.id);

    sessionActive = false;
    const afterSessionEnds = await receiveAfter(iterator, () => pubSub.publish("NOTE_UPDATED", updated));

    assert.equal(afterSessionEnds.done, true);
  });

  test("subscriptions no longer accept shareToken as an argument", () => {
    const errors = validate(schema, parse(legacyShareTokenSubscription));

    assert.ok(errors.some((error) => /shareToken/.test(error.message)));
  });
});

describe("account session subscriptions", () => {
  test("collaborators subscribe with their account session and no ticket", async () => {
    const boardId = await createBoardOwnedBy(owner, "Collaborator subscription board");
    const note = await notes.createNote({
      ownerId: owner.id,
      ownerMetadata: ownerMetadataFor(owner),
      boardId,
      title: "Team note",
      content: "Initial",
    });
    await notes.setBoardCollaborator(owner.id, boardId, collaborator.email, "view", ownerMetadataFor(owner));
    const iterator = await subscribeOrFail(accountContext(collaborator), noteUpdatedSubscription, { boardId });
    const updated = await notes.updateNote({
      ownerId: owner.id,
      ownerMetadata: ownerMetadataFor(owner),
      boardId,
      id: note.id,
      content: "Team update",
    });

    assert.equal(noteIdFromEvent(await receiveAfter(iterator, () => pubSub.publish("NOTE_UPDATED", updated))), note.id);
    await iterator.return();
  });

  test("users without a relationship cannot subscribe without a ticket", async () => {
    const boardId = await createBoardOwnedBy(owner, "Private subscription board");

    const attempt = await subscribeGraphql({
      schema,
      document: parse(noteUpdatedSubscription),
      contextValue: accountContext(outsider),
      variableValues: { boardId },
    });

    assert.deepEqual(subscriptionErrorMessages(attempt), [ACCESS_DENIED_MESSAGE]);
  });
});
