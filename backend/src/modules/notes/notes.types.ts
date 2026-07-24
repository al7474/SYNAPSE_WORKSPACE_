import type { OwnerKind, OwnerMetadata } from "../auth/auth.types.js";

export type { OwnerKind, OwnerMetadata } from "../auth/auth.types.js";

export interface Note {
  id: string;
  boardId: string;
  title: string;
  content: string;
  embeddingPending: boolean;
  createdAt: string;
  updatedAt: string;
  semanticScore?: number | null;
  ownerId?: string;
}

export type BoardPermission = "view" | "edit";

export interface Board {
  id: string;
  ownerId: string;
  ownerKind: OwnerKind;
  ownerUserId: string | null;
  ownerGuestSessionId: string | null;
  name: string;
  shareToken: string | null;
  sharePermission: BoardPermission;
  createdAt: string;
  updatedAt: string;
}

export interface SharedBoardAccess {
  board: Board;
  permission: BoardPermission;
}

export interface BoardCollaborator {
  boardId: string;
  email: string;
  userId: string | null;
  permission: BoardPermission;
  createdAt: string;
  updatedAt: string;
}

export interface AccessIdentity {
  ownerId: string;
  userEmail?: string;
  ownerMetadata?: OwnerMetadata;
}

export interface CreateNoteInput {
  ownerId: string;
  userEmail?: string;
  ownerMetadata?: OwnerMetadata;
  boardId: string;
  shareToken?: string;
  title: string;
  content: string;
}

export interface UpdateNoteInput {
  ownerId: string;
  userEmail?: string;
  ownerMetadata?: OwnerMetadata;
  boardId: string;
  shareToken?: string;
  id: string;
  title?: string;
  content?: string;
}

export interface SemanticSearchInput {
  ownerId: string;
  userEmail?: string;
  ownerMetadata?: OwnerMetadata;
  boardId: string;
  shareToken?: string;
  query: string;
  limit?: number;
  minSimilarity?: number;
}

export interface ListNotesInput {
  ownerId: string;
  userEmail?: string;
  ownerMetadata?: OwnerMetadata;
  boardId: string;
  shareToken?: string;
}
