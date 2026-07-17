export interface Note {
  id: string;
  title: string;
  content: string;
  embeddingPending: boolean;
  createdAt: string;
  updatedAt: string;
  semanticScore?: number | null;
  ownerId?: string;
}

export interface CreateNoteInput {
  ownerId: string;
  title: string;
  content: string;
}

export interface UpdateNoteInput {
  ownerId: string;
  id: string;
  title?: string;
  content?: string;
}

export interface SemanticSearchInput {
  ownerId: string;
  query: string;
  limit?: number;
  minSimilarity?: number;
}
