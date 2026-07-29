import crypto from "node:crypto";
import { Prisma, PrismaClient, type Board as PrismaBoard, type BoardCollaborator as PrismaBoardCollaborator, type Note as PrismaNote } from "@prisma/client";
import type { OwnerKind, OwnerMetadata } from "../auth/auth.types.js";
import { OpenRouterEmbeddingsService } from "../embeddings/openrouter-embeddings.service.js";
import { logger } from "../../observability/logger.js";
import type {
  Board,
  BoardCollaborator,
  BoardPermission,
  CreateNoteInput,
  DeletedNoteEvent,
  ListNotesInput,
  Note,
  SemanticSearchInput,
  SharedBoardAccess,
  UpdateNoteInput,
} from "./notes.types.js";

type BoardRecord = Board & {
  shareTokenHash: string | null;
};

type BoardAccess = {
  board: BoardRecord;
  permission: BoardPermission;
};

type NoteRow = {
  id: bigint;
  board_id: bigint;
  title: string;
  content: string;
  embedding_pending: boolean;
  created_at: Date;
  updated_at: Date;
  owner_id: string;
  semantic_score?: number | string | null;
};

type PrismaNoteRow = Pick<
  PrismaNote,
  | "id"
  | "boardId"
  | "title"
  | "content"
  | "embeddingPending"
  | "createdAt"
  | "updatedAt"
  | "ownerId"
>;

type DbClient = PrismaClient | Prisma.TransactionClient;

export class NotesService {
  constructor(
    private readonly db: PrismaClient,
    private readonly embeddingsService: OpenRouterEmbeddingsService
  ) {}

  private toPgvectorLiteral(vector: number[]): string {
    return `[${vector.join(",")}]`;
  }

  private async buildEmbedding(content: string): Promise<{ vectorLiteral: string | null; pending: boolean }> {
    try {
      const embedding = await this.embeddingsService.generateEmbedding(content);
      return { vectorLiteral: this.toPgvectorLiteral(embedding), pending: false };
    } catch (error) {
      logger.warn("embeddings.generation_failed", { error });
      return { vectorLiteral: null, pending: true };
    }
  }

  private parseId(value: string, resourceName: string): bigint {
    try {
      const parsed = BigInt(value);

      if (parsed > 0n) {
        return parsed;
      }
    } catch {
      // GraphQL IDs are strings, but database identifiers must be positive BIGINT values.
    }

    throw new Error(`${resourceName} not found`);
  }

  private parseOwnerReference(value: string | null | undefined, resourceName: string): bigint {
    if (!value) {
      throw new Error(`Missing ${resourceName} owner reference`);
    }

    return this.parseId(value, resourceName);
  }

  private buildOwnerWhere(
    ownerId: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Prisma.BoardWhereInput {
    if (ownerMetadata.ownerKind === "user") {
      return {
        ownerKind: "user",
        ownerUserId: ownerMetadata.ownerUserId ? BigInt(ownerMetadata.ownerUserId) : -1n,
      };
    }

    if (ownerMetadata.ownerKind === "guest") {
      return {
        ownerKind: "guest",
        ownerGuestSessionId: ownerMetadata.ownerGuestSessionId
          ? BigInt(ownerMetadata.ownerGuestSessionId)
          : -1n,
      };
    }

    return {
      ownerKind: "legacy",
      ownerId,
    };
  }

  private toBoard(row: PrismaBoard): BoardRecord {
    return {
      id: String(row.id),
      ownerId: row.ownerId,
      ownerKind: row.ownerKind as OwnerKind,
      ownerUserId: row.ownerUserId === null ? null : String(row.ownerUserId),
      ownerGuestSessionId:
        row.ownerGuestSessionId === null ? null : String(row.ownerGuestSessionId),
      name: row.name,
      shareLinkActive: row.shareTokenHash !== null,
      sharePermission: row.sharePermission as BoardPermission,
      shareTokenHash: row.shareTokenHash,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private generateShareToken(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  private hashShareToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private matchesShareToken(board: BoardRecord, token: string | null | undefined): boolean {
    if (!token || !board.shareTokenHash) {
      return false;
    }

    const candidateHash = Buffer.from(this.hashShareToken(token), "hex");
    const storedHash = Buffer.from(board.shareTokenHash, "hex");

    return (
      candidateHash.length === storedHash.length &&
      crypto.timingSafeEqual(candidateHash, storedHash)
    );
  }

  private isBoardOwner(
    board: Board,
    ownerId: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): boolean {
    if (ownerMetadata.ownerKind === "user") {
      return board.ownerKind === "user" && board.ownerUserId === ownerMetadata.ownerUserId;
    }

    if (ownerMetadata.ownerKind === "guest") {
      return (
        board.ownerKind === "guest" &&
        board.ownerGuestSessionId === ownerMetadata.ownerGuestSessionId
      );
    }

    return board.ownerKind === "legacy" && board.ownerId === ownerId;
  }

  private toBoardCollaborator(row: PrismaBoardCollaborator): BoardCollaborator {
    return {
      boardId: String(row.boardId),
      email: row.invitedEmail,
      userId: row.userId === null ? null : String(row.userId),
      permission: row.permission as BoardPermission,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async requireBoardAccess(
    ownerId: string,
    userEmail: string | undefined,
    boardId: string,
    shareToken: string | null | undefined,
    requireEdit = false,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<BoardAccess> {
    const boardValue = this.parseId(boardId, "Board");
    const boardRow = await this.db.board.findUnique({ where: { id: boardValue } });

    if (!boardRow) {
      throw new Error("Board not found");
    }

    const board = this.toBoard(boardRow);

    if (this.isBoardOwner(board, ownerId, ownerMetadata)) {
      return { board, permission: "edit" };
    }

    if (userEmail) {
      const collaborator = await this.db.boardCollaborator.findFirst({
        where: {
          boardId: boardValue,
          invitedEmail: userEmail.trim().toLowerCase(),
        },
      });

      if (collaborator) {
        const permission = collaborator.permission as BoardPermission;

        if (requireEdit && permission !== "edit") {
          throw new Error("This board is read-only for your user");
        }

        return { board, permission };
      }
    }

    if (!this.matchesShareToken(board, shareToken)) {
      throw new Error("Access denied for this board");
    }

    if (requireEdit && board.sharePermission !== "edit") {
      throw new Error("This shared board is read-only");
    }

    return { board, permission: board.sharePermission };
  }

  async listBoards(
    ownerId: string,
    userEmail?: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<Board[]> {
    const ownedRows = await this.db.board.findMany({
      where: this.buildOwnerWhere(ownerId, ownerMetadata),
      orderBy: { updatedAt: "desc" },
    });
    const ownedBoards = ownedRows.map((row) => this.toBoard(row));
    const normalizedEmail = userEmail?.trim().toLowerCase();

    if (!normalizedEmail) {
      if (ownedBoards.length === 0) {
        const created = await this.createBoard(ownerId, "My First Board", ownerMetadata);
        return [created];
      }

      return ownedBoards;
    }

    const collaboratorRows = await this.db.board.findMany({
      where: {
        collaborators: {
          some: { invitedEmail: normalizedEmail },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    const merged = [...ownedBoards];

    for (const row of collaboratorRows) {
      const board = this.toBoard(row);

      if (!merged.some((current) => current.id === board.id)) {
        merged.push(board);
      }
    }

    if (merged.length === 0) {
      const created = await this.createBoard(ownerId, "My First Board", ownerMetadata);
      return [created];
    }

    return merged;
  }

  async listBoardCollaborators(
    ownerId: string,
    boardId: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<BoardCollaborator[]> {
    const boardValue = this.parseId(boardId, "Board");
    const ownerCheck = await this.db.board.findFirst({
      where: {
        AND: [{ id: boardValue }, this.buildOwnerWhere(ownerId, ownerMetadata)],
      },
      select: { id: true },
    });

    if (!ownerCheck) {
      throw new Error("Board not found");
    }

    const rows = await this.db.boardCollaborator.findMany({
      where: { boardId: boardValue },
      orderBy: { updatedAt: "desc" },
    });

    return rows.map((row) => this.toBoardCollaborator(row));
  }

  async setBoardCollaborator(
    ownerId: string,
    boardId: string,
    email: string,
    permission: BoardPermission,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<BoardCollaborator> {
    const boardValue = this.parseId(boardId, "Board");
    const ownerCheck = await this.db.board.findFirst({
      where: {
        AND: [{ id: boardValue }, this.buildOwnerWhere(ownerId, ownerMetadata)],
      },
      select: { id: true },
    });

    if (!ownerCheck) {
      throw new Error("Board not found");
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail.includes("@")) {
      throw new Error("Collaborator email is invalid");
    }

    const row = await this.db.boardCollaborator.upsert({
      where: {
        boardId_invitedEmail: {
          boardId: boardValue,
          invitedEmail: normalizedEmail,
        },
      },
      create: {
        boardId: boardValue,
        invitedEmail: normalizedEmail,
        permission,
      },
      update: {
        permission,
        updatedAt: new Date(),
      },
    });

    return this.toBoardCollaborator(row);
  }

  async removeBoardCollaborator(
    ownerId: string,
    boardId: string,
    email: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<boolean> {
    const boardValue = this.parseId(boardId, "Board");
    const ownerCheck = await this.db.board.findFirst({
      where: {
        AND: [{ id: boardValue }, this.buildOwnerWhere(ownerId, ownerMetadata)],
      },
      select: { id: true },
    });

    if (!ownerCheck) {
      throw new Error("Board not found");
    }

    const result = await this.db.boardCollaborator.deleteMany({
      where: {
        boardId: boardValue,
        invitedEmail: email.trim().toLowerCase(),
      },
    });

    return result.count > 0;
  }

  async createBoard(
    ownerId: string,
    name: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<Board> {
    const trimmed = name.trim();

    if (!trimmed) {
      throw new Error("Board name is required");
    }

    const row = await this.db.board.create({
      data: {
        ownerId,
        ownerKind: ownerMetadata.ownerKind,
        ownerUserId:
          ownerMetadata.ownerKind === "user"
            ? this.parseOwnerReference(ownerMetadata.ownerUserId, "user")
            : null,
        ownerGuestSessionId:
          ownerMetadata.ownerKind === "guest"
            ? this.parseOwnerReference(ownerMetadata.ownerGuestSessionId, "guest session")
            : null,
        name: trimmed,
      },
    });

    return this.toBoard(row);
  }

  async updateBoard(
    ownerId: string,
    boardId: string,
    name: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<Board> {
    const trimmed = name.trim();

    if (!trimmed) {
      throw new Error("Board name is required");
    }

    const result = await this.db.board.updateMany({
      where: {
        AND: [{ id: this.parseId(boardId, "Board") }, this.buildOwnerWhere(ownerId, ownerMetadata)],
      },
      data: {
        name: trimmed,
        updatedAt: new Date(),
      },
    });

    if (result.count === 0) {
      throw new Error("Board not found");
    }

    const row = await this.db.board.findUniqueOrThrow({
      where: { id: this.parseId(boardId, "Board") },
    });

    return this.toBoard(row);
  }

  async deleteBoard(
    ownerId: string,
    boardId: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<boolean> {
    const result = await this.db.board.deleteMany({
      where: {
        AND: [{ id: this.parseId(boardId, "Board") }, this.buildOwnerWhere(ownerId, ownerMetadata)],
      },
    });

    return result.count > 0;
  }

  async createShareLink(
    ownerId: string,
    boardId: string,
    permission: BoardPermission,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<string> {
    const token = this.generateShareToken();
    const result = await this.db.board.updateMany({
      where: {
        AND: [{ id: this.parseId(boardId, "Board") }, this.buildOwnerWhere(ownerId, ownerMetadata)],
      },
      data: {
        shareTokenHash: this.hashShareToken(token),
        sharePermission: permission,
        updatedAt: new Date(),
      },
    });

    if (result.count === 0) {
      throw new Error("Board not found");
    }

    return token;
  }

  async revokeShareLink(
    ownerId: string,
    boardId: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<boolean> {
    const result = await this.db.board.updateMany({
      where: {
        AND: [{ id: this.parseId(boardId, "Board") }, this.buildOwnerWhere(ownerId, ownerMetadata)],
      },
      data: {
        shareTokenHash: null,
        updatedAt: new Date(),
      },
    });

    return result.count > 0;
  }

  async accessSharedBoard(
    ownerId: string,
    userEmail: string | undefined,
    token: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<SharedBoardAccess> {
    const row = await this.db.board.findUnique({
      where: { shareTokenHash: this.hashShareToken(token) },
    });

    if (!row) {
      throw new Error("Shared board not found");
    }

    const board = this.toBoard(row);

    if (this.isBoardOwner(board, ownerId, ownerMetadata)) {
      return { board, permission: "edit" };
    }

    if (userEmail) {
      const collaborator = await this.db.boardCollaborator.findFirst({
        where: {
          boardId: board.id ? BigInt(board.id) : 0n,
          invitedEmail: userEmail.trim().toLowerCase(),
        },
      });

      if (collaborator) {
        return {
          board,
          permission: collaborator.permission as BoardPermission,
        };
      }
    }

    return { board, permission: board.sharePermission };
  }

  async assertBoardAccess(
    ownerId: string,
    userEmail: string | undefined,
    boardId: string,
    shareToken: string | undefined,
    requireEdit = false,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<void> {
    await this.requireBoardAccess(
      ownerId,
      userEmail,
      boardId,
      shareToken ?? null,
      requireEdit,
      ownerMetadata
    );
  }

  async createNote(input: CreateNoteInput): Promise<Note> {
    const access = await this.requireBoardAccess(
      input.ownerId,
      input.userEmail,
      input.boardId,
      input.shareToken ?? null,
      true,
      input.ownerMetadata
    );
    const embedding = await this.buildEmbedding(input.content);
    const boardId = this.parseId(input.boardId, "Board");

    return this.db.$transaction(async (transaction) => {
      const row = await transaction.note.create({
        data: {
          ownerId: access.board.ownerId,
          ownerKind: access.board.ownerKind,
          ownerUserId: access.board.ownerUserId
            ? BigInt(access.board.ownerUserId)
            : null,
          ownerGuestSessionId: access.board.ownerGuestSessionId
            ? BigInt(access.board.ownerGuestSessionId)
            : null,
          boardId,
          title: input.title,
          content: input.content,
          embeddingPending: embedding.pending,
        },
      });

      await this.setEmbedding(transaction, row.id, embedding.vectorLiteral);
      const saved = await transaction.note.findUniqueOrThrow({ where: { id: row.id } });
      return this.toNote(saved);
    });
  }

  async updateNote(input: UpdateNoteInput): Promise<Note> {
    await this.requireBoardAccess(
      input.ownerId,
      input.userEmail,
      input.boardId,
      input.shareToken ?? null,
      true,
      input.ownerMetadata
    );
    const noteId = this.parseId(input.id, "Note");
    const boardId = this.parseId(input.boardId, "Board");
    const current = await this.db.note.findFirst({
      where: { id: noteId, boardId },
      select: { title: true, content: true },
    });

    if (!current) {
      throw new Error("Note not found");
    }

    const nextContent = input.content ?? current.content;
    const contentChanged = nextContent !== current.content;

    if (!contentChanged) {
      const row = await this.db.note.update({
        where: { id: noteId },
        data: {
          title: input.title ?? undefined,
          updatedAt: new Date(),
        },
      });
      return this.toNote(row);
    }

    const embedding = await this.buildEmbedding(nextContent);

    return this.db.$transaction(async (transaction) => {
      await transaction.note.update({
        where: { id: noteId },
        data: {
          title: input.title ?? undefined,
          content: nextContent,
          embeddingPending: embedding.pending,
          updatedAt: new Date(),
        },
      });
      await this.setEmbedding(transaction, noteId, embedding.vectorLiteral);
      const row = await transaction.note.findUniqueOrThrow({ where: { id: noteId } });
      return this.toNote(row);
    });
  }

  async listNotes(input: ListNotesInput): Promise<Note[]> {
    await this.requireBoardAccess(
      input.ownerId,
      input.userEmail,
      input.boardId,
      input.shareToken ?? null,
      false,
      input.ownerMetadata
    );

    const rows = await this.db.note.findMany({
      where: { boardId: this.parseId(input.boardId, "Board") },
      orderBy: { updatedAt: "desc" },
    });

    return rows.map((row) => this.toNote(row));
  }

  async semanticSearch(input: SemanticSearchInput): Promise<Note[]> {
    await this.requireBoardAccess(
      input.ownerId,
      input.userEmail,
      input.boardId,
      input.shareToken ?? null,
      false,
      input.ownerMetadata
    );

    const limit = Math.max(1, Math.min(input.limit ?? 5, 20));
    const minSimilarity = Math.max(0, Math.min(input.minSimilarity ?? 0.55, 1));
    const embedding = await this.embeddingsService.generateEmbedding(input.query);
    const vectorLiteral = this.toPgvectorLiteral(embedding);
    const boardId = this.parseId(input.boardId, "Board");
    const rows = await this.db.$queryRaw<NoteRow[]>(Prisma.sql`
      SELECT
        "id",
        "title",
        "content",
        "embedding_pending",
        "created_at",
        "updated_at",
        "board_id",
        "owner_id",
        (1 - ("embedding" <=> ${vectorLiteral}::vector)) AS "semantic_score"
      FROM "notes"
      WHERE "board_id" = ${boardId}
        AND "embedding" IS NOT NULL
        AND (1 - ("embedding" <=> ${vectorLiteral}::vector)) >= ${minSimilarity}
      ORDER BY "embedding" <=> ${vectorLiteral}::vector ASC
      LIMIT ${limit}
    `);

    return rows.map((row) => this.toNote(row));
  }

  async deleteNote(
    ownerId: string,
    userEmail: string | undefined,
    boardId: string,
    shareToken: string | undefined,
    id: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<boolean> {
    return Boolean(
      await this.deleteNoteWithMetadata(
        ownerId,
        userEmail,
        boardId,
        shareToken,
        id,
        ownerMetadata
      )
    );
  }

  async deleteNoteWithMetadata(
    ownerId: string,
    userEmail: string | undefined,
    boardId: string,
    shareToken: string | undefined,
    id: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<DeletedNoteEvent | null> {
    await this.requireBoardAccess(
      ownerId,
      userEmail,
      boardId,
      shareToken ?? null,
      true,
      ownerMetadata
    );
    const noteId = this.parseId(id, "Note");
    const boardValue = this.parseId(boardId, "Board");

    return this.db.$transaction(async (transaction) => {
      const note = await transaction.note.findFirst({
        where: { id: noteId, boardId: boardValue },
        select: { id: true, boardId: true },
      });

      if (!note) {
        return null;
      }

      const result = await transaction.note.deleteMany({
        where: { id: note.id, boardId: note.boardId },
      });

      return result.count > 0
        ? { id: String(note.id), boardId: String(note.boardId) }
        : null;
    });
  }

  async reindexPendingEmbeddingsForBoard(
    ownerId: string,
    userEmail: string | undefined,
    boardId: string,
    shareToken: string | undefined,
    limit = 20,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<Note[]> {
    await this.requireBoardAccess(
      ownerId,
      userEmail,
      boardId,
      shareToken ?? null,
      true,
      ownerMetadata
    );

    const safeLimit = Math.max(1, Math.min(limit, 100));
    const boardValue = this.parseId(boardId, "Board");
    const pending = await this.db.note.findMany({
      where: { boardId: boardValue, embeddingPending: true },
      orderBy: { updatedAt: "asc" },
      take: safeLimit,
      select: { id: true, content: true },
    });
    const updatedNotes: Note[] = [];

    for (const row of pending) {
      const embedding = await this.buildEmbedding(row.content);

      if (!embedding.vectorLiteral || embedding.pending) {
        continue;
      }

      const updated = await this.updateReindexedEmbedding(
        row.id,
        boardValue,
        row.content,
        embedding.vectorLiteral
      );

      if (updated) {
        updatedNotes.push(updated);
      }
    }

    return updatedNotes;
  }

  async reindexPendingEmbeddings(limit = 20): Promise<Note[]> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const pending = await this.db.note.findMany({
      where: { embeddingPending: true },
      orderBy: { updatedAt: "asc" },
      take: safeLimit,
      select: { id: true, boardId: true, content: true },
    });
    const updatedNotes: Note[] = [];

    for (const row of pending) {
      const embedding = await this.buildEmbedding(row.content);

      if (!embedding.vectorLiteral || embedding.pending) {
        continue;
      }

      const updated = await this.updateReindexedEmbedding(
        row.id,
        row.boardId,
        row.content,
        embedding.vectorLiteral
      );

      if (updated) {
        updatedNotes.push(updated);
      }
    }

    return updatedNotes;
  }

  async countPendingEmbeddings(): Promise<number> {
    return this.db.note.count({ where: { embeddingPending: true } });
  }

  private async setEmbedding(
    client: DbClient,
    noteId: bigint,
    vectorLiteral: string | null
  ): Promise<void> {
    if (vectorLiteral === null) {
      await client.$executeRaw(Prisma.sql`
        UPDATE "notes"
        SET "embedding" = NULL
        WHERE "id" = ${noteId}
      `);
      return;
    }

    await client.$executeRaw(Prisma.sql`
      UPDATE "notes"
      SET "embedding" = ${vectorLiteral}::vector
      WHERE "id" = ${noteId}
    `);
  }

  private async updateReindexedEmbedding(
    noteId: bigint,
    boardId: bigint,
    expectedContent: string,
    vectorLiteral: string
  ): Promise<Note | null> {
    const updatedCount = await this.db.$executeRaw(Prisma.sql`
      UPDATE "notes"
      SET "embedding" = ${vectorLiteral}::vector,
          "embedding_pending" = FALSE,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${noteId}
        AND "board_id" = ${boardId}
        AND "content" = ${expectedContent}
    `);

    if (updatedCount === 0) {
      return null;
    }

    const row = await this.db.note.findUnique({ where: { id: noteId } });
    return row ? this.toNote(row) : null;
  }

  private toNote(row: PrismaNoteRow | NoteRow): Note {
    if ("boardId" in row) {
      return {
        id: String(row.id),
        boardId: String(row.boardId),
        title: row.title,
        content: row.content,
        embeddingPending: row.embeddingPending,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        semanticScore: null,
        ownerId: row.ownerId,
      };
    }

    return {
      id: String(row.id),
      boardId: String(row.board_id),
      title: row.title,
      content: row.content,
      embeddingPending: row.embedding_pending,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      semanticScore:
        row.semantic_score === undefined || row.semantic_score === null
          ? null
          : Number(row.semantic_score),
      ownerId: row.owner_id,
    };
  }
}