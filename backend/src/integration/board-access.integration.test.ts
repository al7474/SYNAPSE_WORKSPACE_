import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { execute, parse, type GraphQLSchema } from "graphql";
import { buildSchema, type NotePubSub } from "../graphql/schema.js";
import type { OwnerMetadata } from "../modules/auth/auth.types.js";
import { OpenRouterEmbeddingsService } from "../modules/embeddings/openrouter-embeddings.service.js";
import { McpOAuthService } from "../modules/mcp/oauth.service.js";
import { NotesService } from "../modules/notes/notes.service.js";

const databaseUrl = process.env.DATABASE_URL;
const embedding = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));
const runId = `${process.pid}-${Date.now()}`;
const READ_ONLY_USER_MESSAGE = "This board is read-only for your user";
const READ_ONLY_LINK_MESSAGE = "This shared board is read-only";
const ACCESS_DENIED_MESSAGE = "Access denied for this board";
const INVALID_SHARE_TOKEN = "invalid-share-token";

interface TestUser {
  id: string;
  email: string;
}

interface TestSession {
  ownerId: string;
  userEmail?: string;
  ownerMetadata: OwnerMetadata;
}

const noopPubSub: NotePubSub = {
  publish: async () => undefined,
  subscribe: () => {
    throw new Error("Subscriptions are not used by these tests");
  },
};

const listNotesQuery = /* GraphQL */ `
  query ListNotes($boardId: ID!) {
    listNotes(boardId: $boardId) {
      id
      title
    }
  }
`;

const listCollaboratorsQuery = /* GraphQL */ `
  query ListBoardCollaborators($boardId: ID!) {
    listBoardCollaborators(boardId: $boardId) {
      email
      permission
    }
  }
`;

const setCollaboratorMutation = /* GraphQL */ `
  mutation SetBoardCollaborator($boardId: ID!, $email: String!, $permission: BoardPermission!) {
    setBoardCollaborator(boardId: $boardId, email: $email, permission: $permission) {
      email
      permission
    }
  }
`;

let db: PrismaClient;
let notes: NotesService;
let schema: GraphQLSchema;
let owner: TestUser;
let collaborator: TestUser;
let outsider: TestUser;
let unverifiedOwner: TestUser;
let visitor: TestSession;

const createdUserIds: bigint[] = [];
const createdGuestSessionIds: bigint[] = [];
const createdMcpClientIds: bigint[] = [];
const mcpOAuthOptions = {
  resource: "https://synapse.test/mcp",
  authorizationCodeTtlMs: 60 * 1000,
  accessTokenTtlMs: 60 * 60 * 1000,
  refreshTokenTtlMs: 24 * 60 * 60 * 1000,
};

function createEmbeddingResponse(): Response {
  return new Response(JSON.stringify({ data: [{ embedding }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createNotesService(): NotesService {
  const fetchImpl: typeof fetch = async () => createEmbeddingResponse();
  const embeddingsService = new OpenRouterEmbeddingsService(
    "ci-mock-openrouter-key",
    "ci-mock-embedding-model",
    embedding.length,
    { fetchImpl, retryDelayMs: 0 }
  );

  return new NotesService(db, embeddingsService);
}

async function createUser(label: string, emailVerified: boolean): Promise<TestUser> {
  const row = await db.user.create({
    data: {
      email: `board-access-${label}-${runId}@example.test`,
      name: `Board access ${label}`,
      passwordHash: "ci-integration-not-used-for-login",
      emailVerifiedAt: emailVerified ? new Date() : null,
    },
  });

  createdUserIds.push(row.id);
  return { id: String(row.id), email: row.email };
}

async function createGuestVisitor(): Promise<TestSession> {
  const guestSession = await db.guestSession.create({
    data: {
      tokenHash: `board-access-guest-${runId}`,
      ownerId: `board-access-guest-owner-${runId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  createdGuestSessionIds.push(guestSession.id);
  return {
    ownerId: guestSession.ownerId,
    ownerMetadata: { ownerKind: "guest", ownerGuestSessionId: String(guestSession.id) },
  };
}

function sessionFor(user: TestUser): TestSession {
  return {
    ownerId: user.id,
    userEmail: user.email,
    ownerMetadata: { ownerKind: "user", ownerUserId: user.id },
  };
}

async function createBoardOwnedBy(user: TestUser, name: string): Promise<string> {
  const session = sessionFor(user);
  const board = await notes.createBoard(session.ownerId, name, session.ownerMetadata);
  return board.id;
}

function createGraphqlContext(user: TestUser, emailVerified: boolean) {
  return {
    notesService: notes,
    sessionId: user.id,
    userEmail: user.email,
    emailVerified,
    ownerMetadata: { ownerKind: "user" as const, ownerUserId: user.id },
    revalidateSession: async () => true,
  };
}

async function executeGraphql(
  contextValue: ReturnType<typeof createGraphqlContext>,
  source: string,
  variableValues: Record<string, unknown>
) {
  return execute({ schema, document: parse(source), contextValue, variableValues });
}

async function createMcpAccessTokenFor(userId: string): Promise<string> {
  const client = await db.mcpClient.create({
    data: {
      clientId: `board-access-client-${runId}-${createdMcpClientIds.length}`,
      redirectUris: ["http://127.0.0.1/callback"],
    },
  });
  createdMcpClientIds.push(client.id);

  const token = crypto.randomBytes(32).toString("base64url");
  await db.mcpAccessToken.create({
    data: {
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      clientId: client.id,
      userId: BigInt(userId),
      scopes: ["notes:read"],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return token;
}

before(async () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for integration tests");
  }

  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await db.$connect();

  notes = createNotesService();
  schema = buildSchema(noopPubSub);
  owner = await createUser("owner", true);
  collaborator = await createUser("collaborator", true);
  outsider = await createUser("outsider", true);
  unverifiedOwner = await createUser("unverified-owner", false);
  visitor = await createGuestVisitor();
});

after(async () => {
  await db?.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await db?.guestSession.deleteMany({ where: { id: { in: createdGuestSessionIds } } });
  await db?.mcpClient.deleteMany({ where: { id: { in: createdMcpClientIds } } });
  await db?.$disconnect();
});

describe("NotesService board access control", () => {
  test("owner keeps edit permission over notes on their board", async () => {
    const boardId = await createBoardOwnedBy(owner, "Owner edit board");
    const ownerSession = sessionFor(owner);

    const created = await notes.createNote({
      ...ownerSession,
      boardId,
      title: "Owner note",
      content: "Owner content",
    });
    const updated = await notes.updateNote({
      ...ownerSession,
      boardId,
      id: created.id,
      content: "Owner edited content",
    });
    const deleted = await notes.deleteNote(
      ownerSession.ownerId,
      ownerSession.userEmail,
      boardId,
      undefined,
      created.id,
      ownerSession.ownerMetadata
    );

    assert.equal(updated.content, "Owner edited content");
    assert.equal(deleted, true);
  });

  test("collaborator with view permission can read but cannot create, edit or delete notes", async () => {
    const boardId = await createBoardOwnedBy(owner, "Read-only collaborator board");
    const ownerSession = sessionFor(owner);
    const reader = sessionFor(collaborator);
    const note = await notes.createNote({
      ...ownerSession,
      boardId,
      title: "Shared note",
      content: "Original content",
    });

    await notes.setBoardCollaborator(
      ownerSession.ownerId,
      boardId,
      collaborator.email,
      "view",
      ownerSession.ownerMetadata
    );

    const visible = await notes.listNotes({ ...reader, boardId });
    assert.deepEqual(visible.map((item) => item.id), [note.id]);

    await assert.rejects(
      notes.createNote({ ...reader, boardId, title: "Blocked", content: "Blocked content" }),
      { message: READ_ONLY_USER_MESSAGE }
    );
    await assert.rejects(
      notes.updateNote({ ...reader, boardId, id: note.id, content: "Blocked edit" }),
      { message: READ_ONLY_USER_MESSAGE }
    );
    await assert.rejects(
      notes.deleteNote(reader.ownerId, reader.userEmail, boardId, undefined, note.id, reader.ownerMetadata),
      { message: READ_ONLY_USER_MESSAGE }
    );

    const stored = await db.note.findMany({
      where: { boardId: BigInt(boardId) },
      select: { title: true, content: true },
    });
    assert.deepEqual(stored, [{ title: "Shared note", content: "Original content" }]);
  });

  test("collaborator with edit permission can create and update notes", async () => {
    const boardId = await createBoardOwnedBy(owner, "Editable collaborator board");
    const ownerSession = sessionFor(owner);
    const editor = sessionFor(collaborator);

    await notes.setBoardCollaborator(
      ownerSession.ownerId,
      boardId,
      collaborator.email,
      "edit",
      ownerSession.ownerMetadata
    );

    const created = await notes.createNote({
      ...editor,
      boardId,
      title: "Collaborator note",
      content: "Collaborator content",
    });
    const updated = await notes.updateNote({
      ...editor,
      boardId,
      id: created.id,
      content: "Collaborator edited content",
    });

    assert.equal(created.ownerId, owner.id);
    assert.equal(updated.content, "Collaborator edited content");
  });

  test("downgrading a collaborator to view removes write access", async () => {
    const boardId = await createBoardOwnedBy(owner, "Downgraded collaborator board");
    const ownerSession = sessionFor(owner);
    const editor = sessionFor(collaborator);

    await notes.setBoardCollaborator(
      ownerSession.ownerId,
      boardId,
      collaborator.email,
      "edit",
      ownerSession.ownerMetadata
    );
    const created = await notes.createNote({
      ...editor,
      boardId,
      title: "Before downgrade",
      content: "Before downgrade content",
    });

    await notes.setBoardCollaborator(
      ownerSession.ownerId,
      boardId,
      collaborator.email,
      "view",
      ownerSession.ownerMetadata
    );

    await assert.rejects(
      notes.createNote({ ...editor, boardId, title: "After downgrade", content: "Blocked content" }),
      { message: READ_ONLY_USER_MESSAGE }
    );
    await assert.rejects(
      notes.updateNote({ ...editor, boardId, id: created.id, content: "Blocked edit" }),
      { message: READ_ONLY_USER_MESSAGE }
    );
  });

  test("share link with view permission grants read-only access only with the valid token", async () => {
    const boardId = await createBoardOwnedBy(owner, "View link board");
    const ownerSession = sessionFor(owner);
    const note = await notes.createNote({
      ...ownerSession,
      boardId,
      title: "Linked note",
      content: "Linked content",
    });
    const token = await notes.createShareLink(
      ownerSession.ownerId,
      boardId,
      "view",
      ownerSession.ownerMetadata
    );

    const visible = await notes.listNotes({ ...visitor, boardId, shareToken: token });
    assert.deepEqual(visible.map((item) => item.id), [note.id]);

    await assert.rejects(
      notes.createNote({ ...visitor, boardId, shareToken: token, title: "Blocked", content: "Blocked content" }),
      { message: READ_ONLY_LINK_MESSAGE }
    );
    await assert.rejects(
      notes.listNotes({ ...visitor, boardId, shareToken: INVALID_SHARE_TOKEN }),
      { message: ACCESS_DENIED_MESSAGE }
    );
    await assert.rejects(
      notes.createNote({
        ...visitor,
        boardId,
        shareToken: INVALID_SHARE_TOKEN,
        title: "Blocked",
        content: "Blocked content",
      }),
      { message: ACCESS_DENIED_MESSAGE }
    );
    await assert.rejects(notes.listNotes({ ...visitor, boardId }), { message: ACCESS_DENIED_MESSAGE });

    assert.equal(await db.note.count({ where: { boardId: BigInt(boardId) } }), 1);
  });

  test("share link with edit permission allows note writes only with the valid token", async () => {
    const boardId = await createBoardOwnedBy(owner, "Edit link board");
    const ownerSession = sessionFor(owner);
    const token = await notes.createShareLink(
      ownerSession.ownerId,
      boardId,
      "edit",
      ownerSession.ownerMetadata
    );

    const created = await notes.createNote({
      ...visitor,
      boardId,
      shareToken: token,
      title: "Link note",
      content: "Link content",
    });
    const updated = await notes.updateNote({
      ...visitor,
      boardId,
      shareToken: token,
      id: created.id,
      content: "Link edited content",
    });

    assert.equal(updated.content, "Link edited content");
    await assert.rejects(
      notes.createNote({
        ...visitor,
        boardId,
        shareToken: INVALID_SHARE_TOKEN,
        title: "Blocked",
        content: "Blocked content",
      }),
      { message: ACCESS_DENIED_MESSAGE }
    );
    await assert.rejects(
      notes.updateNote({
        ...visitor,
        boardId,
        shareToken: INVALID_SHARE_TOKEN,
        id: created.id,
        content: "Blocked edit",
      }),
      { message: ACCESS_DENIED_MESSAGE }
    );
  });

  test("share token only grants access to the board it was created for", async () => {
    const boardId = await createBoardOwnedBy(owner, "Token source board");
    const otherBoardId = await createBoardOwnedBy(owner, "Other board");
    const ownerSession = sessionFor(owner);
    const token = await notes.createShareLink(
      ownerSession.ownerId,
      boardId,
      "edit",
      ownerSession.ownerMetadata
    );

    await assert.rejects(
      notes.listNotes({ ...visitor, boardId: otherBoardId, shareToken: token }),
      { message: ACCESS_DENIED_MESSAGE }
    );
    await assert.rejects(
      notes.createNote({
        ...visitor,
        boardId: otherBoardId,
        shareToken: token,
        title: "Cross-board",
        content: "Cross-board content",
      }),
      { message: ACCESS_DENIED_MESSAGE }
    );
  });

  test("createShareLink replaces the previous token", async () => {
    const boardId = await createBoardOwnedBy(owner, "Replaced token board");
    const ownerSession = sessionFor(owner);
    const firstToken = await notes.createShareLink(
      ownerSession.ownerId,
      boardId,
      "view",
      ownerSession.ownerMetadata
    );
    const secondToken = await notes.createShareLink(
      ownerSession.ownerId,
      boardId,
      "edit",
      ownerSession.ownerMetadata
    );

    assert.notEqual(secondToken, firstToken);
    await assert.rejects(
      notes.listNotes({ ...visitor, boardId, shareToken: firstToken }),
      { message: ACCESS_DENIED_MESSAGE }
    );
    await assert.rejects(
      notes.createNote({
        ...visitor,
        boardId,
        shareToken: firstToken,
        title: "Old token",
        content: "Old token content",
      }),
      { message: ACCESS_DENIED_MESSAGE }
    );

    const created = await notes.createNote({
      ...visitor,
      boardId,
      shareToken: secondToken,
      title: "Replacement note",
      content: "Replacement content",
    });
    assert.equal(created.boardId, boardId);
  });

  test("revokeShareLink invalidates the token and only the owner can revoke it", async () => {
    const boardId = await createBoardOwnedBy(owner, "Revoked link board");
    const ownerSession = sessionFor(owner);
    const editor = sessionFor(collaborator);
    const token = await notes.createShareLink(
      ownerSession.ownerId,
      boardId,
      "edit",
      ownerSession.ownerMetadata
    );

    await notes.setBoardCollaborator(
      ownerSession.ownerId,
      boardId,
      collaborator.email,
      "edit",
      ownerSession.ownerMetadata
    );

    assert.equal(
      await notes.revokeShareLink(editor.ownerId, boardId, editor.ownerMetadata),
      false
    );
    await notes.listNotes({ ...visitor, boardId, shareToken: token });

    assert.equal(
      await notes.revokeShareLink(ownerSession.ownerId, boardId, ownerSession.ownerMetadata),
      true
    );
    await assert.rejects(
      notes.listNotes({ ...visitor, boardId, shareToken: token }),
      { message: ACCESS_DENIED_MESSAGE }
    );
    await assert.rejects(
      notes.createNote({ ...visitor, boardId, shareToken: token, title: "Revoked", content: "Revoked content" }),
      { message: ACCESS_DENIED_MESSAGE }
    );
    await assert.rejects(
      notes.accessSharedBoard(visitor.ownerId, undefined, token, visitor.ownerMetadata),
      { message: "Shared board not found" }
    );
  });

  test("users without a relationship to the board are denied", async () => {
    const boardId = await createBoardOwnedBy(owner, "Private board");
    const ownerSession = sessionFor(owner);
    const note = await notes.createNote({
      ...ownerSession,
      boardId,
      title: "Private note",
      content: "Private content",
    });
    const stranger = sessionFor(outsider);

    await assert.rejects(notes.listNotes({ ...stranger, boardId }), { message: ACCESS_DENIED_MESSAGE });
    await assert.rejects(
      notes.createNote({ ...stranger, boardId, title: "Intruder", content: "Intruder content" }),
      { message: ACCESS_DENIED_MESSAGE }
    );
    await assert.rejects(
      notes.updateNote({ ...stranger, boardId, id: note.id, content: "Intruder edit" }),
      { message: ACCESS_DENIED_MESSAGE }
    );
    await assert.rejects(
      notes.deleteNote(stranger.ownerId, stranger.userEmail, boardId, undefined, note.id, stranger.ownerMetadata),
      { message: ACCESS_DENIED_MESSAGE }
    );
    await assert.rejects(
      notes.semanticSearch({ ...stranger, boardId, query: "Private content" }),
      { message: ACCESS_DENIED_MESSAGE }
    );

    assert.equal(await db.note.count({ where: { boardId: BigInt(boardId) } }), 1);
  });
});

describe("GraphQL email verification for collaborator management", () => {
  test("rejects unverified users with EMAIL_VERIFICATION_REQUIRED before changing collaborators", async () => {
    const boardId = await createBoardOwnedBy(unverifiedOwner, "Unverified GraphQL board");
    const context = createGraphqlContext(unverifiedOwner, false);

    const listed = await executeGraphql(context, listCollaboratorsQuery, { boardId });
    const changed = await executeGraphql(context, setCollaboratorMutation, {
      boardId,
      email: outsider.email,
      permission: "view",
    });

    assert.equal(listed.data, null);
    assert.equal(listed.errors?.[0]?.extensions?.code, "EMAIL_VERIFICATION_REQUIRED");
    assert.equal(changed.data, null);
    assert.equal(changed.errors?.[0]?.extensions?.code, "EMAIL_VERIFICATION_REQUIRED");
    assert.equal(await db.boardCollaborator.count({ where: { boardId: BigInt(boardId) } }), 0);
  });

  test("lets verified owners list and change collaborators", async () => {
    const boardId = await createBoardOwnedBy(owner, "Verified GraphQL board");
    const context = createGraphqlContext(owner, true);

    const changed = await executeGraphql(context, setCollaboratorMutation, {
      boardId,
      email: collaborator.email,
      permission: "edit",
    });
    const listed = await executeGraphql(context, listCollaboratorsQuery, { boardId });

    assert.equal(changed.errors, undefined);
    assert.deepEqual(structuredClone(changed.data), {
      setBoardCollaborator: { email: collaborator.email, permission: "edit" },
    });
    assert.equal(listed.errors, undefined);
    assert.deepEqual(structuredClone(listed.data), {
      listBoardCollaborators: [{ email: collaborator.email, permission: "edit" }],
    });
  });

  test("unverified accounts whose email is invited cannot read board notes", async () => {
    const invitee = await createUser("unverified-invitee", false);
    const boardId = await createBoardOwnedBy(owner, "Unverified invitee board");
    const ownerSession = sessionFor(owner);
    await notes.createNote({
      ...ownerSession,
      boardId,
      title: "Private note",
      content: "Private content",
    });
    await notes.setBoardCollaborator(
      ownerSession.ownerId,
      boardId,
      invitee.email,
      "view",
      ownerSession.ownerMetadata
    );

    const result = await executeGraphql(createGraphqlContext(invitee, false), listNotesQuery, { boardId });

    assert.equal(result.data, null);
    assert.equal(result.errors?.[0]?.message, ACCESS_DENIED_MESSAGE);
  });

  test("verified invitees can read board notes through GraphQL", async () => {
    const boardId = await createBoardOwnedBy(owner, "Verified invitee board");
    const ownerSession = sessionFor(owner);
    const note = await notes.createNote({
      ...ownerSession,
      boardId,
      title: "Shared note",
      content: "Shared content",
    });
    await notes.setBoardCollaborator(
      ownerSession.ownerId,
      boardId,
      collaborator.email,
      "view",
      ownerSession.ownerMetadata
    );

    const result = await executeGraphql(createGraphqlContext(collaborator, true), listNotesQuery, { boardId });

    assert.equal(result.errors, undefined);
    assert.deepEqual(structuredClone(result.data), {
      listNotes: [{ id: note.id, title: "Shared note" }],
    });
  });

  test("unverified owners keep access to notes on boards they own", async () => {
    const boardId = await createBoardOwnedBy(unverifiedOwner, "Unverified owner board");
    const ownerSession = sessionFor(unverifiedOwner);
    const note = await notes.createNote({
      ...ownerSession,
      boardId,
      title: "Own note",
      content: "Own content",
    });

    const result = await executeGraphql(createGraphqlContext(unverifiedOwner, false), listNotesQuery, { boardId });

    assert.equal(result.errors, undefined);
    assert.deepEqual(structuredClone(result.data), {
      listNotes: [{ id: note.id, title: "Own note" }],
    });
  });
});

describe("MCP access token context", () => {
  test("unverified invitees cannot read board notes through an MCP token", async () => {
    const invitee = await createUser("mcp-unverified-invitee", false);
    const boardId = await createBoardOwnedBy(owner, "MCP invitee board");
    const ownerSession = sessionFor(owner);
    await notes.createNote({
      ...ownerSession,
      boardId,
      title: "MCP note",
      content: "MCP content",
    });
    await notes.setBoardCollaborator(
      ownerSession.ownerId,
      boardId,
      invitee.email,
      "view",
      ownerSession.ownerMetadata
    );

    const oauth = new McpOAuthService(db, mcpOAuthOptions);
    const tokenContext = await oauth.verifyAccessToken(await createMcpAccessTokenFor(invitee.id));

    assert.equal(tokenContext.userEmail, undefined);
    await assert.rejects(
      notes.listNotes({
        ownerId: tokenContext.userId,
        userEmail: tokenContext.userEmail,
        ownerMetadata: { ownerKind: "user", ownerUserId: tokenContext.userId },
        boardId,
      }),
      { message: ACCESS_DENIED_MESSAGE }
    );
  });

  test("verified accounts keep their email in the MCP token context", async () => {
    const oauth = new McpOAuthService(db, mcpOAuthOptions);
    const tokenContext = await oauth.verifyAccessToken(await createMcpAccessTokenFor(collaborator.id));

    assert.equal(tokenContext.userId, collaborator.id);
    assert.equal(tokenContext.userEmail, collaborator.email);
  });
});
