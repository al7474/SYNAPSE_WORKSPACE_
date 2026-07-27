export type BoardPermission = "view" | "edit";
export type SessionMode = "guest" | "user";
export type AuthMode = "login" | "register" | "forgot-password";
export type NotesFilter = "all" | "indexed" | "pending";
export type ToastKind = "success" | "error" | "info";

export type Note = {
  id: string;
  boardId: string;
  title: string;
  content: string;
  embeddingPending: boolean;
  semanticScore?: number | null;
};

export type Board = {
  id: string;
  ownerId: string;
  name: string;
  shareLinkActive: boolean;
  shareToken?: string | null;
  sharePermission: BoardPermission;
};

export type SharedBoardAccess = {
  board: Board;
  permission: BoardPermission;
};

export type BoardCollaborator = {
  boardId: string;
  email: string;
  permission: BoardPermission;
};

export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

export type SessionState = {
  sessionId: string;
  sessionMode: SessionMode;
  userEmail: string | null;
  emailVerified: boolean;
};
