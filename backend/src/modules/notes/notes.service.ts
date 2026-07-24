import type { Pool } from "pg";
import crypto from "node:crypto";
import type { OwnerKind, OwnerMetadata } from "../auth/auth.types.js";
import { OpenRouterEmbeddingsService } from "../embeddings/openrouter-embeddings.service.js";
import type {
  Board,
  BoardCollaborator,
  BoardPermission,
  CreateNoteInput,
  ListNotesInput,
  Note,
  SemanticSearchInput,
  SharedBoardAccess,
  UpdateNoteInput,
} from "./notes.types.js";

type NoteRow = {
  id: string | number;
  board_id: string | number;
  title: string;
  content: string;
  embedding_pending: boolean;
  created_at: Date;
  updated_at: Date;
  owner_id: string;
  semantic_score?: number | string | null;
};

type BoardRow = {
  id: string | number;
  owner_id: string;
  owner_kind: OwnerKind;
  owner_user_id: string | number | null;
  owner_guest_session_id: string | number | null;
  name: string;
  share_token: string | null;
  share_permission: BoardPermission;
  created_at: Date;
  updated_at: Date;
};

type BoardAccess = {
  board: Board;
  permission: BoardPermission;
};

type BoardCollaboratorRow = {
  board_id: string | number;
  invited_email: string;
  user_id: string | number | null;
  permission: BoardPermission;
  created_at: Date;
  updated_at: Date;
};

export class NotesService {
  constructor(
    private readonly pool: Pool,
    private readonly embeddingsService: OpenRouterEmbeddingsService
  ) {}

  private toPgvectorLiteral(vector: number[]): string {
    return `[${vector.join(",")}]`;
  }

  private async buildEmbedding(content: string): Promise<{ vectorLiteral: string | null; pending: boolean }> {
    try {
      const embedding = await this.embeddingsService.generateEmbedding(content);
      return { vectorLiteral: this.toPgvectorLiteral(embedding), pending: false };
    } catch {
      return { vectorLiteral: null, pending: true };
    }
  }

  private toBoard(row: BoardRow): Board {
    return {
      id: String(row.id),
      ownerId: row.owner_id,
      ownerKind: row.owner_kind,
      ownerUserId: row.owner_user_id === null ? null : String(row.owner_user_id),
      ownerGuestSessionId:
        row.owner_guest_session_id === null ? null : String(row.owner_guest_session_id),
      name: row.name,
      shareToken: row.share_token,
      sharePermission: row.share_permission,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private generateShareToken(): string {
    return crypto.randomBytes(18).toString("base64url");
  }

  private toBoardCollaborator(row: BoardCollaboratorRow): BoardCollaborator {
    return {
      boardId: String(row.board_id),
      email: row.invited_email,
      userId: row.user_id === null ? null : String(row.user_id),
      permission: row.permission,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async requireBoardAccess(
    ownerId: string,
    userEmail: string | undefined,
    boardId: string,
    shareToken: string | null | undefined,
    requireEdit = false
  ): Promise<BoardAccess> {
    const boardResult = await this.pool.query(
      `
      SELECT id, owner_id, owner_kind, owner_user_id, owner_guest_session_id,
         name, share_token, share_permission, created_at, updated_at
      FROM boards
      WHERE id = $1
      `,
      [boardId]
    );

    if (boardResult.rowCount === 0) {
      throw new Error("Board not found");
    }

    const board = this.toBoard(boardResult.rows[0] as BoardRow);

    if (board.ownerId === ownerId) {
      return { board, permission: "edit" };
    }

    if (userEmail) {
      const collaboratorResult = await this.pool.query(
        `
        SELECT permission
        FROM board_collaborators
        WHERE board_id = $1 AND invited_email = $2
        `,
        [boardId, userEmail.trim().toLowerCase()]
      );

      if ((collaboratorResult.rowCount ?? 0) > 0) {
        const permission = collaboratorResult.rows[0].permission as BoardPermission;

        if (requireEdit && permission !== "edit") {
          throw new Error("This board is read-only for your user");
        }

        return { board, permission };
      }
    }

    if (!shareToken || !board.shareToken || shareToken !== board.shareToken) {
      throw new Error("Access denied for this board");
    }

    if (requireEdit) {
      if (board.sharePermission !== "edit") {
        throw new Error("This shared board is read-only");
      }
    }

    return { board, permission: board.sharePermission };
  }

  async listBoards(
    ownerId: string,
    userEmail?: string,
    ownerMetadata: OwnerMetadata = { ownerKind: "legacy" }
  ): Promise<Board[]> {
    const result = await this.pool.query(
      `
      SELECT id, owner_id, owner_kind, owner_user_id, owner_guest_session_id,
         name, share_token, share_permission, created_at, updated_at
      FROM boards
      WHERE owner_id = $1
      ORDER BY updated_at DESC
      `,
      [ownerId]
    );

    const ownedBoards = result.rows.map((row) => this.toBoard(row as BoardRow));

    const normalizedEmail = userEmail?.trim().toLowerCase();

    if (!normalizedEmail) {
      if (ownedBoards.length === 0) {
        const created = await this.createBoard(ownerId, "My First Board", ownerMetadata);
        return [created];
      }

      return ownedBoards;
    }

    const collaboratorBoards = await this.pool.query(
      `
      SELECT b.id, b.owner_id, b.owner_kind, b.owner_user_id, b.owner_guest_session_id,
         b.name, b.share_token, b.share_permission, b.created_at, b.updated_at
      FROM boards b
      INNER JOIN board_collaborators c ON c.board_id = b.id
      WHERE c.invited_email = $1
      ORDER BY b.updated_at DESC
      `,
      [normalizedEmail]
    );

    const merged = [...ownedBoards];

    for (const row of collaboratorBoards.rows) {
      const board = this.toBoard(row as BoardRow);

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

  async listBoardCollaborators(ownerId: string, boardId: string): Promise<BoardCollaborator[]> {
    const ownerCheck = await this.pool.query(
      `SELECT 1 FROM boards WHERE id = $1 AND owner_id = $2`,
      [boardId, ownerId]
    );

    if ((ownerCheck.rowCount ?? 0) === 0) {
      throw new Error("Board not found");
    }

    const result = await this.pool.query(
      `
      SELECT board_id, invited_email, user_id, permission, created_at, updated_at
      FROM board_collaborators
      WHERE board_id = $1
      ORDER BY updated_at DESC
      `,
      [boardId]
    );

    return result.rows.map((row) => this.toBoardCollaborator(row as BoardCollaboratorRow));
  }

  async setBoardCollaborator(
    ownerId: string,
    boardId: string,
    email: string,
    permission: BoardPermission
  ): Promise<BoardCollaborator> {
    const ownerCheck = await this.pool.query(
      `SELECT 1 FROM boards WHERE id = $1 AND owner_id = $2`,
      [boardId, ownerId]
    );

    if ((ownerCheck.rowCount ?? 0) === 0) {
      throw new Error("Board not found");
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail.includes("@")) {
      throw new Error("Collaborator email is invalid");
    }

    const result = await this.pool.query(
      `
      INSERT INTO board_collaborators (board_id, invited_email, permission)
      VALUES ($1, $2, $3)
      ON CONFLICT (board_id, invited_email)
      DO UPDATE SET
        permission = EXCLUDED.permission,
        updated_at = NOW()
      RETURNING board_id, invited_email, user_id, permission, created_at, updated_at
      `,
      [boardId, normalizedEmail, permission]
    );

    return this.toBoardCollaborator(result.rows[0] as BoardCollaboratorRow);
  }

  async removeBoardCollaborator(ownerId: string, boardId: string, email: string): Promise<boolean> {
    const ownerCheck = await this.pool.query(
      `SELECT 1 FROM boards WHERE id = $1 AND owner_id = $2`,
      [boardId, ownerId]
    );

    if ((ownerCheck.rowCount ?? 0) === 0) {
      throw new Error("Board not found");
    }

    const result = await this.pool.query(
      `DELETE FROM board_collaborators WHERE board_id = $1 AND invited_email = $2`,
      [boardId, email.trim().toLowerCase()]
    );

    return (result.rowCount ?? 0) > 0;
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

    const result = await this.pool.query(
      `
      INSERT INTO boards (
        owner_id,
        owner_kind,
        owner_user_id,
        owner_guest_session_id,
        name
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, owner_id, owner_kind, owner_user_id, owner_guest_session_id,
                name, share_token, share_permission, created_at, updated_at
      `,
      [
        ownerId,
        ownerMetadata.ownerKind,
        ownerMetadata.ownerUserId ?? null,
        ownerMetadata.ownerGuestSessionId ?? null,
        trimmed,
      ]
    );

    return this.toBoard(result.rows[0] as BoardRow);
  }

  async updateBoard(ownerId: string, boardId: string, name: string): Promise<Board> {
    const trimmed = name.trim();

    if (!trimmed) {
      throw new Error("Board name is required");
    }

    const result = await this.pool.query(
      `
      UPDATE boards
      SET name = $1,
          updated_at = NOW()
      WHERE id = $2 AND owner_id = $3
      RETURNING id, owner_id, owner_kind, owner_user_id, owner_guest_session_id,
            name, share_token, share_permission, created_at, updated_at
      `,
      [trimmed, boardId, ownerId]
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new Error("Board not found");
    }

    return this.toBoard(result.rows[0] as BoardRow);
  }

  async deleteBoard(ownerId: string, boardId: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM boards WHERE id = $1 AND owner_id = $2`, [boardId, ownerId]);
    return (result.rowCount ?? 0) > 0;
  }

  async createShareLink(ownerId: string, boardId: string, permission: BoardPermission): Promise<string> {
    const token = this.generateShareToken();

    const result = await this.pool.query(
      `
      UPDATE boards
      SET share_token = $1,
          share_permission = $2,
          updated_at = NOW()
      WHERE id = $3 AND owner_id = $4
      RETURNING share_token
      `,
      [token, permission, boardId, ownerId]
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new Error("Board not found");
    }

    return result.rows[0].share_token as string;
  }

  async accessSharedBoard(ownerId: string, userEmail: string | undefined, token: string): Promise<SharedBoardAccess> {
    const result = await this.pool.query(
      `
      SELECT id, owner_id, owner_kind, owner_user_id, owner_guest_session_id,
         name, share_token, share_permission, created_at, updated_at
      FROM boards
      WHERE share_token = $1
      `,
      [token]
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new Error("Shared board not found");
    }

    const board = this.toBoard(result.rows[0] as BoardRow);

    if (board.ownerId === ownerId) {
      return {
        board,
        permission: "edit",
      };
    }

    if (userEmail) {
      const collaboratorResult = await this.pool.query(
        `
        SELECT permission
        FROM board_collaborators
        WHERE board_id = $1 AND invited_email = $2
        `,
        [board.id, userEmail.trim().toLowerCase()]
      );

      if ((collaboratorResult.rowCount ?? 0) > 0) {
        return {
          board,
          permission: collaboratorResult.rows[0].permission as BoardPermission,
        };
      }
    }

    return {
      board,
      permission: board.sharePermission,
    };
  }

  async createNote(input: CreateNoteInput): Promise<Note> {
    const access = await this.requireBoardAccess(
      input.ownerId,
      input.userEmail,
      input.boardId,
      input.shareToken ?? null,
      true
    );
    const embedding = await this.buildEmbedding(input.content);

    const result = await this.pool.query(
      `
      INSERT INTO notes (
        owner_id,
        owner_kind,
        owner_user_id,
        owner_guest_session_id,
        board_id,
        title,
        content,
        embedding,
        embedding_pending
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9)
      RETURNING id, board_id, title, content, embedding_pending, created_at, updated_at, owner_id
      `,
      [
        access.board.ownerId,
        access.board.ownerKind,
        access.board.ownerUserId,
        access.board.ownerGuestSessionId,
        input.boardId,
        input.title,
        input.content,
        embedding.vectorLiteral,
        embedding.pending,
      ]
    );

    return this.toNote(result.rows[0]);
  }

  async updateNote(input: UpdateNoteInput): Promise<Note> {
    await this.requireBoardAccess(
      input.ownerId,
      input.userEmail,
      input.boardId,
      input.shareToken ?? null,
      true
    );
    const current = await this.pool.query(
      `SELECT id, title, content FROM notes WHERE id = $1 AND board_id = $2`,
      [input.id, input.boardId]
    );

    if (current.rowCount === 0) {
      throw new Error("Note not found");
    }

    const currentRow = current.rows[0] as { title: string; content: string };
    const nextContent = input.content ?? currentRow.content;
    const contentChanged = nextContent !== currentRow.content;

    let vectorLiteral: string | null = null;
    let embeddingPending = false;

    if (contentChanged) {
      const embedding = await this.buildEmbedding(nextContent);
      vectorLiteral = embedding.vectorLiteral;
      embeddingPending = embedding.pending;
    }

    const result = await this.pool.query(
      `
      UPDATE notes
      SET title = COALESCE($1, title),
          content = COALESCE($2, content),
          embedding = CASE WHEN $4::boolean THEN $3::vector ELSE embedding END,
          embedding_pending = CASE WHEN $4::boolean THEN $5 ELSE embedding_pending END,
          updated_at = NOW()
          WHERE id = $6 AND board_id = $7
          RETURNING id, board_id, title, content, embedding_pending, created_at, updated_at, owner_id
      `,
      [
        input.title ?? null,
        input.content ?? null,
        vectorLiteral,
        contentChanged,
        embeddingPending,
        input.id,
        input.boardId,
      ]
    );

    if (result.rowCount === 0) {
      throw new Error("Note not found");
    }

    return this.toNote(result.rows[0]);
  }

  async listNotes(input: ListNotesInput): Promise<Note[]> {
    await this.requireBoardAccess(
      input.ownerId,
      input.userEmail,
      input.boardId,
      input.shareToken ?? null,
      false
    );

    const result = await this.pool.query(
      `
      SELECT id, board_id, title, content, embedding_pending, created_at, updated_at, owner_id
      FROM notes
      WHERE board_id = $1
      ORDER BY updated_at DESC
      `,
      [input.boardId]
    );

    return result.rows.map((row) => this.toNote(row as NoteRow));
  }

  async semanticSearch(input: SemanticSearchInput): Promise<Note[]> {
    await this.requireBoardAccess(
      input.ownerId,
      input.userEmail,
      input.boardId,
      input.shareToken ?? null,
      false
    );

    const limit = Math.max(1, Math.min(input.limit ?? 5, 20));
    const minSimilarity = Math.max(0, Math.min(input.minSimilarity ?? 0.55, 1));
    const embedding = await this.embeddingsService.generateEmbedding(input.query);
    const vectorLiteral = this.toPgvectorLiteral(embedding);

    const result = await this.pool.query(
      `
      SELECT
        id,
        title,
        content,
        embedding_pending,
        created_at,
        updated_at,
        board_id,
        owner_id,
        (1 - (embedding <=> $1::vector)) AS semantic_score
      FROM notes
      WHERE board_id = $4
        AND embedding IS NOT NULL
        AND (1 - (embedding <=> $1::vector)) >= $3
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $2
      `,
      [vectorLiteral, limit, minSimilarity, input.boardId]
    );

    return result.rows.map((row) => this.toNote(row as NoteRow));
  }

  async deleteNote(
    ownerId: string,
    userEmail: string | undefined,
    boardId: string,
    shareToken: string | undefined,
    id: string
  ): Promise<boolean> {
    await this.requireBoardAccess(ownerId, userEmail, boardId, shareToken ?? null, true);
    const result = await this.pool.query(`DELETE FROM notes WHERE id = $1 AND board_id = $2`, [id, boardId]);
    return (result.rowCount ?? 0) > 0;
  }

  async reindexPendingEmbeddingsForBoard(
    ownerId: string,
    userEmail: string | undefined,
    boardId: string,
    shareToken: string | undefined,
    limit = 20
  ): Promise<Note[]> {
    await this.requireBoardAccess(ownerId, userEmail, boardId, shareToken ?? null, true);

    const safeLimit = Math.max(1, Math.min(limit, 100));

    const pending = await this.pool.query(
      `
      SELECT id, content
      FROM notes
      WHERE board_id = $1 AND embedding_pending = TRUE
      ORDER BY updated_at ASC
      LIMIT $2
      `,
      [boardId, safeLimit]
    );

    const updatedNotes: Note[] = [];

    for (const row of pending.rows as Array<{ id: string | number; content: string }>) {
      const embedding = await this.buildEmbedding(row.content);

      if (!embedding.vectorLiteral || embedding.pending) {
        continue;
      }

      const updated = await this.pool.query(
        `
        UPDATE notes
        SET embedding = $1::vector,
            embedding_pending = FALSE,
            updated_at = NOW()
        WHERE id = $2 AND board_id = $3
        RETURNING id, board_id, title, content, embedding_pending, created_at, updated_at, owner_id
        `,
        [embedding.vectorLiteral, String(row.id), boardId]
      );

      if ((updated.rowCount ?? 0) > 0) {
        updatedNotes.push(this.toNote(updated.rows[0] as NoteRow));
      }
    }

    return updatedNotes;
  }

  async reindexPendingEmbeddings(limit = 20): Promise<Note[]> {
    const safeLimit = Math.max(1, Math.min(limit, 100));

    const pending = await this.pool.query(
      `
      SELECT id, content
      FROM notes
      WHERE embedding_pending = TRUE
      ORDER BY updated_at ASC
      LIMIT $1
      `,
      [safeLimit]
    );

    const updatedNotes: Note[] = [];

    for (const row of pending.rows as Array<{ id: string | number; content: string }>) {
      const embedding = await this.buildEmbedding(row.content);

      if (!embedding.vectorLiteral || embedding.pending) {
        continue;
      }

      const updated = await this.pool.query(
        `
        UPDATE notes
        SET embedding = $1::vector,
            embedding_pending = FALSE,
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, board_id, title, content, embedding_pending, created_at, updated_at, owner_id
        `,
        [embedding.vectorLiteral, String(row.id)]
      );

      if ((updated.rowCount ?? 0) > 0) {
        updatedNotes.push(this.toNote(updated.rows[0] as NoteRow));
      }
    }

    return updatedNotes;
  }

  private toNote(row: NoteRow): Note {
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
