export interface Note {
  id: string;
  title: string;
  content: string;
  embeddingPending: boolean;
  createdAt: string;
  updatedAt: string;
  semanticScore?: number | null;
}

export interface CreateNoteInput {
  title: string;
  content: string;
}

export interface UpdateNoteInput {
  id: string;
  title?: string;
  content?: string;
}

export interface SemanticSearchInput {
  query: string;
  limit?: number;
  minSimilarity?: number;
}
