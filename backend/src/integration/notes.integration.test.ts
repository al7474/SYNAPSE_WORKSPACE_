import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { OpenRouterEmbeddingsService } from "../modules/embeddings/openrouter-embeddings.service.js";
import { NotesService } from "../modules/notes/notes.service.js";

const databaseUrl = process.env.DATABASE_URL;
const embedding = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));
const legacyOwnerMetadata = { ownerKind: "legacy" as const };

let db: PrismaClient;

function createEmbeddingResponse(): Response {
  return new Response(JSON.stringify({ data: [{ embedding }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createNotesService(fetchImpl: typeof fetch): NotesService {
  const embeddingsService = new OpenRouterEmbeddingsService(
    "ci-mock-openrouter-key",
    "ci-mock-embedding-model",
    embedding.length,
    { fetchImpl, retryDelayMs: 0 }
  );

  return new NotesService(db, embeddingsService);
}

async function deleteBoard(boardId: string): Promise<void> {
  await db.board.delete({ where: { id: BigInt(boardId) } });
}

before(async () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for integration tests");
  }

  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await db.$connect();
});

after(async () => {
  await db?.$disconnect();
});

test("persists notes and searches migrated pgvector data with a mocked OpenRouter", async () => {
  const ownerId = `ci-integration-owner-${process.pid}-${Date.now()}`;
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(`${String(input)}:${String(init?.body)}`);
    return createEmbeddingResponse();
  };
  const notes = createNotesService(fetchImpl);
  const board = await notes.createBoard(ownerId, "CI integration board", legacyOwnerMetadata);

  try {
    const created = await notes.createNote({
      ownerId,
      ownerMetadata: legacyOwnerMetadata,
      boardId: board.id,
      title: "Integration note",
      content: "PostgreSQL and pgvector integration content",
    });

    assert.equal(created.embeddingPending, false);
    assert.equal(calls.length, 1);

    const stored = await db.note.findUniqueOrThrow({ where: { id: BigInt(created.id) } });
    const dimensions = await db.$queryRaw<Array<{ dimensions: number }>>`
      SELECT vector_dims("embedding") AS dimensions
      FROM "notes"
      WHERE "id" = ${BigInt(created.id)}
    `;

    assert.equal(stored.embeddingPending, false);
    assert.equal(Number(dimensions[0].dimensions), embedding.length);

    const matches = await notes.semanticSearch({
      ownerId,
      ownerMetadata: legacyOwnerMetadata,
      boardId: board.id,
      query: "PostgreSQL and pgvector integration content",
    });

    assert.equal(matches[0]?.id, created.id);
    assert.equal(calls.length, 2);
  } finally {
    await deleteBoard(board.id);
  }
});

test("does not overwrite content edited while a pending embedding is generated", async () => {
  const ownerId = `ci-stale-owner-${process.pid}-${Date.now()}`;
  const notes = createNotesService(async () => {
    await db.note.update({
      where: { id: pendingNoteId },
      data: { content: "Fresh user edit", updatedAt: new Date() },
    });
    return createEmbeddingResponse();
  });
  const board = await notes.createBoard(ownerId, "CI stale embedding board", legacyOwnerMetadata);
  const pendingNote = await db.note.create({
    data: {
      ownerId,
      ownerKind: "legacy",
      boardId: BigInt(board.id),
      title: "Pending note",
      content: "Content captured by the reindex worker",
      embeddingPending: true,
    },
  });
  const pendingNoteId = pendingNote.id;

  try {
    const reindexed = await notes.reindexPendingEmbeddingsForBoard(
      ownerId,
      undefined,
      board.id,
      undefined,
      20,
      legacyOwnerMetadata
    );
    const current = await db.note.findUniqueOrThrow({ where: { id: pendingNote.id } });
    const embeddingState = await db.$queryRaw<Array<{ has_embedding: boolean }>>`
      SELECT "embedding" IS NOT NULL AS has_embedding
      FROM "notes"
      WHERE "id" = ${pendingNote.id}
    `;

    assert.deepEqual(reindexed, []);
    assert.equal(current.content, "Fresh user edit");
    assert.equal(current.embeddingPending, true);
    assert.equal(embeddingState[0].has_embedding, false);
  } finally {
    await deleteBoard(board.id);
  }
});

function embeddedInputOf(body: BodyInit | null | undefined): string {
  return (JSON.parse(String(body)) as { input: string }).input;
}

test("embeds title and content together and regenerates when only the title changes", async () => {
  const ownerId = `ci-title-owner-${process.pid}-${Date.now()}`;
  const embeddedInputs: string[] = [];
  const notes = createNotesService(async (_input, init) => {
    embeddedInputs.push(embeddedInputOf(init?.body));
    return createEmbeddingResponse();
  });
  const board = await notes.createBoard(ownerId, "CI title embedding board", legacyOwnerMetadata);

  try {
    const created = await notes.createNote({
      ownerId,
      ownerMetadata: legacyOwnerMetadata,
      boardId: board.id,
      title: "Original title",
      content: "Shared body",
    });
    const updated = await notes.updateNote({
      ownerId,
      ownerMetadata: legacyOwnerMetadata,
      boardId: board.id,
      id: created.id,
      title: "Renamed title",
    });
    const stored = await db.$queryRaw<Array<{ has_embedding: boolean }>>`
      SELECT "embedding" IS NOT NULL AS has_embedding
      FROM "notes"
      WHERE "id" = ${BigInt(created.id)}
    `;

    assert.deepEqual(embeddedInputs, ["Original title\n\nShared body", "Renamed title\n\nShared body"]);
    assert.equal(updated.embeddingPending, false);
    assert.equal(stored[0].has_embedding, true);
  } finally {
    await deleteBoard(board.id);
  }
});

test("keeps the previous embedding searchable when regeneration fails", async () => {
  const ownerId = `ci-fallback-owner-${process.pid}-${Date.now()}`;
  const healthyNotes = createNotesService(async () => createEmbeddingResponse());
  const failingNotes = createNotesService(async () => {
    throw new Error("OpenRouter unavailable");
  });
  const board = await healthyNotes.createBoard(ownerId, "CI failed regeneration board", legacyOwnerMetadata);

  try {
    const created = await healthyNotes.createNote({
      ownerId,
      ownerMetadata: legacyOwnerMetadata,
      boardId: board.id,
      title: "Stable title",
      content: "Stable body",
    });
    const updated = await failingNotes.updateNote({
      ownerId,
      ownerMetadata: legacyOwnerMetadata,
      boardId: board.id,
      id: created.id,
      content: "Edited while offline",
    });
    const stored = await db.$queryRaw<Array<{ has_embedding: boolean }>>`
      SELECT "embedding" IS NOT NULL AS has_embedding
      FROM "notes"
      WHERE "id" = ${BigInt(created.id)}
    `;
    const matches = await healthyNotes.semanticSearch({
      ownerId,
      ownerMetadata: legacyOwnerMetadata,
      boardId: board.id,
      query: "Stable body",
    });

    assert.equal(updated.content, "Edited while offline");
    assert.equal(updated.embeddingPending, true);
    assert.equal(stored[0].has_embedding, true);
    assert.equal(matches[0]?.id, created.id);
  } finally {
    await deleteBoard(board.id);
  }
});

test("does not overwrite a title edited while a pending embedding is generated", async () => {
  const ownerId = `ci-stale-title-owner-${process.pid}-${Date.now()}`;
  const notes = createNotesService(async () => {
    await db.note.update({
      where: { id: pendingNote.id },
      data: { title: "Fresh title", updatedAt: new Date() },
    });
    return createEmbeddingResponse();
  });
  const board = await notes.createBoard(ownerId, "CI stale title board", legacyOwnerMetadata);
  const pendingNote = await db.note.create({
    data: {
      ownerId,
      ownerKind: "legacy",
      boardId: BigInt(board.id),
      title: "Pending title",
      content: "Content captured by the reindex worker",
      embeddingPending: true,
    },
  });

  try {
    const reindexed = await notes.reindexPendingEmbeddingsForBoard(
      ownerId,
      undefined,
      board.id,
      undefined,
      20,
      legacyOwnerMetadata
    );
    const current = await db.note.findUniqueOrThrow({ where: { id: pendingNote.id } });

    assert.deepEqual(reindexed, []);
    assert.equal(current.title, "Fresh title");
    assert.equal(current.embeddingPending, true);
  } finally {
    await deleteBoard(board.id);
  }
});

