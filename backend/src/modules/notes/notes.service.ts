import type { Pool } from "pg";
import { OpenRouterEmbeddingsService } from "../embeddings/openrouter-embeddings.service.js";
import type { CreateNoteInput, Note, SemanticSearchInput, UpdateNoteInput } from "./notes.types.js";

type NoteRow = {
  id: string | number;
  title: string;
  content: string;
  embedding_pending: boolean;
  created_at: Date;
  updated_at: Date;
  semantic_score?: number | string | null;
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

  async createNote(input: CreateNoteInput): Promise<Note> {
    const embedding = await this.buildEmbedding(input.content);

    const result = await this.pool.query(
      `
      INSERT INTO notes (title, content, embedding, embedding_pending)
      VALUES ($1, $2, $3::vector, $4)
      RETURNING id, title, content, embedding_pending, created_at, updated_at
      `,
      [input.title, input.content, embedding.vectorLiteral, embedding.pending]
    );

    return this.toNote(result.rows[0]);
  }

  async updateNote(input: UpdateNoteInput): Promise<Note> {
    const current = await this.pool.query(
      `SELECT id, title, content FROM notes WHERE id = $1`,
      [input.id]
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
      WHERE id = $6
      RETURNING id, title, content, embedding_pending, created_at, updated_at
      `,
      [
        input.title ?? null,
        input.content ?? null,
        vectorLiteral,
        contentChanged,
        embeddingPending,
        input.id,
      ]
    );

    if (result.rowCount === 0) {
      throw new Error("Note not found");
    }

    return this.toNote(result.rows[0]);
  }

  async listNotes(): Promise<Note[]> {
    const result = await this.pool.query(
      `
      SELECT id, title, content, embedding_pending, created_at, updated_at
      FROM notes
      ORDER BY updated_at DESC
      `
    );

    return result.rows.map((row) => this.toNote(row as NoteRow));
  }

  async semanticSearch(input: SemanticSearchInput): Promise<Note[]> {
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
        (1 - (embedding <=> $1::vector)) AS semantic_score
      FROM notes
      WHERE embedding IS NOT NULL
        AND (1 - (embedding <=> $1::vector)) >= $3
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $2
      `,
      [vectorLiteral, limit, minSimilarity]
    );

    return result.rows.map((row) => this.toNote(row as NoteRow));
  }

  async deleteNote(id: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM notes WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
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
        RETURNING id, title, content, embedding_pending, created_at, updated_at
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
      title: row.title,
      content: row.content,
      embeddingPending: row.embedding_pending,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      semanticScore:
        row.semantic_score === undefined || row.semantic_score === null
          ? null
          : Number(row.semantic_score),
    };
  }
}
