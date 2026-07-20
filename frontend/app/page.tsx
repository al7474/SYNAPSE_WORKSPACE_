"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const BlockNoteEditorClient = dynamic(
  () => import("@/components/editor/blocknote-editor-client").then((module) => module.BlockNoteEditorClient),
  { ssr: false }
);

type Note = {
  id: string;
  boardId: string;
  title: string;
  content: string;
  embeddingPending: boolean;
  semanticScore?: number | null;
};

type BoardPermission = "view" | "edit";

type Board = {
  id: string;
  ownerId: string;
  name: string;
  shareToken: string | null;
  sharePermission: BoardPermission;
};

type SharedBoardAccess = {
  board: Board;
  permission: BoardPermission;
};

type BoardCollaborator = {
  boardId: string;
  email: string;
  permission: BoardPermission;
};

type NotesFilter = "all" | "indexed" | "pending";
type ToastKind = "success" | "error" | "info";

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

type SessionMode = "guest" | "user";
type AuthMode = "login" | "register";

const GRAPHQL_ENDPOINT =
  process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT || "http://localhost:4000/graphql";

const SESSION_ID_KEY = "synapse_session_id";
const SESSION_MODE_KEY = "synapse_session_mode";
const USER_EMAIL_KEY = "synapse_user_email";
const LEGACY_GUEST_SESSION_KEY = "synapse_guest_session_id";

function createGuestSessionId(): string {
  return typeof crypto.randomUUID === "function"
    ? `guest_${crypto.randomUUID()}`
    : `guest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function createUserSessionId(email: string): string {
  const normalizedEmail = email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `user_${normalizedEmail}`;
}

async function graphQLRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  sessionId?: string,
  userEmail?: string | null
): Promise<T> {
  if (!sessionId) {
    throw new Error("Session not initialized");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-session-id": sessionId,
  };

  if (userEmail) {
    headers["x-user-email"] = userEmail;
  }

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((error) => error.message).join(" | ") || "GraphQL request failed";
    throw new Error(message);
  }

  if (!payload.data) {
    throw new Error("GraphQL request returned no data");
  }

  return payload.data;
}

function mergeBoards(existingBoards: Board[], incomingBoard: Board): Board[] {
  const index = existingBoards.findIndex((board) => board.id === incomingBoard.id);

  if (index === -1) {
    return [incomingBoard, ...existingBoards];
  }

  const copy = [...existingBoards];
  copy[index] = incomingBoard;
  return copy;
}

function buildShareLink(token: string): string {
  return `${window.location.origin}${window.location.pathname}?share=${token}`;
}

export default function HomePage() {
  const [sessionId, setSessionId] = useState<string>("");
  const [sessionMode, setSessionMode] = useState<SessionMode | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isHydratingSession, setIsHydratingSession] = useState(true);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string>("");
  const [activeShareToken, setActiveShareToken] = useState<string | null>(null);
  const [activePermission, setActivePermission] = useState<BoardPermission>("edit");
  const [isBoardsLoading, setIsBoardsLoading] = useState(false);
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<BoardCollaborator[]>([]);
  const [isCollaboratorsLoading, setIsCollaboratorsLoading] = useState(false);

  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draftTitle, setDraftTitle] = useState("Quick note");
  const [draftContent, setDraftContent] = useState("Start writing your Synapse note...");
  const [searchText, setSearchText] = useState("");
  const [minSimilarity, setMinSimilarity] = useState(0.62);
  const [notesFilter, setNotesFilter] = useState<NotesFilter>("all");
  const [isManualSearching, setIsManualSearching] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [semanticResults, setSemanticResults] = useState<Note[] | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [status, setStatus] = useState("Initializing secure workspace environment...");

  const autoSearchDebounceRef = useRef<number | null>(null);
  const semanticRequestSeqRef = useRef(0);

  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 2600);
  }, []);

  const persistSession = useCallback((nextSessionId: string, nextMode: SessionMode) => {
    window.localStorage.setItem(SESSION_ID_KEY, nextSessionId);
    window.localStorage.setItem(SESSION_MODE_KEY, nextMode);
    setSessionId(nextSessionId);
    setSessionMode(nextMode);
  }, []);

  const clearSession = useCallback(() => {
    window.localStorage.removeItem(SESSION_ID_KEY);
    window.localStorage.removeItem(SESSION_MODE_KEY);
    window.localStorage.removeItem(USER_EMAIL_KEY);
    setSessionId("");
    setSessionMode(null);
    setBoards([]);
    setActiveBoardId("");
    setActiveShareToken(null);
    setActivePermission("edit");
    setNotes([]);
    setSelectedId("");
    setSemanticResults(null);
    setAuthName("");
    setAuthEmail("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthError("");
    setCurrentUserEmail(null);
  }, []);

  const activeBoard = useMemo(
    () => boards.find((board) => board.id === activeBoardId) || null,
    [boards, activeBoardId]
  );

  const canEditBoard = useMemo(() => {
    if (!activeBoard) {
      return false;
    }

    if (activeBoard.ownerId === sessionId) {
      return true;
    }

    return activePermission === "edit";
  }, [activeBoard, sessionId, activePermission]);

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedId) || null,
    [notes, selectedId]
  );

  const filteredNotes = useMemo(() => {
    if (notesFilter === "indexed") {
      return notes.filter((note) => !note.embeddingPending);
    }

    if (notesFilter === "pending") {
      return notes.filter((note) => note.embeddingPending);
    }

    return notes;
  }, [notes, notesFilter]);

  const visibleNotes = useMemo(() => {
    if (semanticResults) {
      return semanticResults;
    }

    return filteredNotes;
  }, [filteredNotes, semanticResults]);

  const loadBoards = useCallback(async () => {
    if (!sessionId) {
      return;
    }

    setIsBoardsLoading(true);

    try {
      const data = await graphQLRequest<{ listBoards: Board[] }>(
        `
        query {
          listBoards {
            id
            ownerId
            name
            shareToken
            sharePermission
          }
        }
        `,
        undefined,
        sessionId,
        currentUserEmail
      );

      setBoards(data.listBoards);

      if (!activeBoardId && data.listBoards.length > 0) {
        setActiveBoardId(data.listBoards[0].id);
        setActiveShareToken(null);
        setActivePermission("edit");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load boards");
    } finally {
      setIsBoardsLoading(false);
    }
  }, [sessionId, activeBoardId, currentUserEmail]);

  const loadCollaborators = useCallback(async () => {
    if (!activeBoard || activeBoard.ownerId !== sessionId) {
      setCollaborators([]);
      return;
    }

    setIsCollaboratorsLoading(true);

    try {
      const data = await graphQLRequest<{ listBoardCollaborators: BoardCollaborator[] }>(
        `
        query ListBoardCollaborators($boardId: ID!) {
          listBoardCollaborators(boardId: $boardId) {
            boardId
            email
            permission
          }
        }
        `,
        {
          boardId: activeBoard.id,
        },
        sessionId,
        currentUserEmail
      );

      setCollaborators(data.listBoardCollaborators);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load collaborators");
    } finally {
      setIsCollaboratorsLoading(false);
    }
  }, [activeBoard, sessionId, currentUserEmail]);

  const loadNotes = useCallback(async () => {
    if (!sessionId || !activeBoardId) {
      return;
    }

    setIsLoading(true);
    setStatus("Loading notes...");

    try {
      const data = await graphQLRequest<{ listNotes: Note[] }>(
        `
        query ListNotes($boardId: ID!, $shareToken: String) {
          listNotes(boardId: $boardId, shareToken: $shareToken) {
            id
            boardId
            title
            content
            embeddingPending
            semanticScore
          }
        }
        `,
        {
          boardId: activeBoardId,
          shareToken: activeShareToken,
        },
        sessionId,
        currentUserEmail
      );

      setNotes(data.listNotes);
      setSemanticResults(null);

      if (data.listNotes.length > 0) {
        setSelectedId((prevSelectedId) => {
          if (prevSelectedId) {
            return prevSelectedId;
          }

          const first = data.listNotes[0];
          setDraftTitle(first.title);
          setDraftContent(first.content);
          return first.id;
        });
      }

      setStatus("Workspace synced");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load notes");
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, activeBoardId, activeShareToken, currentUserEmail]);

  useEffect(() => {
    const storedSessionId = window.localStorage.getItem(SESSION_ID_KEY)?.trim() || "";
    const storedSessionMode = window.localStorage.getItem(SESSION_MODE_KEY) as SessionMode | null;
    const storedUserEmail = window.localStorage.getItem(USER_EMAIL_KEY)?.trim().toLowerCase() || "";
    const legacyGuestId = window.localStorage.getItem(LEGACY_GUEST_SESSION_KEY)?.trim() || "";

    if (storedSessionId && (storedSessionMode === "guest" || storedSessionMode === "user")) {
      setSessionId(storedSessionId);
      setSessionMode(storedSessionMode);
      setCurrentUserEmail(storedSessionMode === "user" && storedUserEmail ? storedUserEmail : null);
    } else if (legacyGuestId) {
      persistSession(legacyGuestId, "guest");
      window.localStorage.removeItem(LEGACY_GUEST_SESSION_KEY);
    }

    setIsHydratingSession(false);
  }, [persistSession]);

  const handleGuestAccess = useCallback(() => {
    const nextGuestSession = createGuestSessionId();
    persistSession(nextGuestSession, "guest");
    window.localStorage.removeItem(USER_EMAIL_KEY);
    setCurrentUserEmail(null);
    setStatus("Guest session active");
    pushToast("info", "You are in guest mode");
  }, [persistSession, pushToast]);

  const handleSignIn = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAuthError("");

      const email = authEmail.trim().toLowerCase();

      if (!email.includes("@")) {
        setAuthError("Please use a valid email address");
        return;
      }

      if (authPassword.trim().length < 6) {
        setAuthError("Password must be at least 6 characters");
        return;
      }

      setIsSigningIn(true);

      try {
        const nextUserSession = createUserSessionId(email);
        persistSession(nextUserSession, "user");
        window.localStorage.setItem(USER_EMAIL_KEY, email);
        setCurrentUserEmail(email);
        setStatus("Signed in");
        pushToast("success", "Welcome back");
      } finally {
        setIsSigningIn(false);
      }
    },
    [authEmail, authPassword, persistSession, pushToast]
  );

  const handleRegister = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAuthError("");

      const name = authName.trim();
      const email = authEmail.trim().toLowerCase();

      if (name.length < 2) {
        setAuthError("Name must be at least 2 characters");
        return;
      }

      if (!email.includes("@")) {
        setAuthError("Please use a valid email address");
        return;
      }

      if (authPassword.trim().length < 6) {
        setAuthError("Password must be at least 6 characters");
        return;
      }

      if (authPassword !== authConfirmPassword) {
        setAuthError("Passwords do not match");
        return;
      }

      setIsSigningIn(true);

      try {
        const nextUserSession = createUserSessionId(email);
        persistSession(nextUserSession, "user");
        window.localStorage.setItem(USER_EMAIL_KEY, email);
        setCurrentUserEmail(email);
        setStatus("Account created");
        pushToast("success", `Welcome ${name}`);
      } finally {
        setIsSigningIn(false);
      }
    },
    [authName, authEmail, authPassword, authConfirmPassword, persistSession, pushToast]
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    void loadBoards();
  }, [sessionId, loadBoards]);

  useEffect(() => {
    void loadCollaborators();
  }, [loadCollaborators]);

  useEffect(() => {
    if (!sessionId || boards.length === 0) {
      return;
    }

    const shareToken = new URL(window.location.href).searchParams.get("share");

    if (!shareToken) {
      return;
    }

    void (async () => {
      try {
        const data = await graphQLRequest<{ accessSharedBoard: SharedBoardAccess }>(
          `
          query AccessSharedBoard($token: String!) {
            accessSharedBoard(token: $token) {
              permission
              board {
                id
                ownerId
                name
                shareToken
                sharePermission
              }
            }
          }
          `,
          { token: shareToken },
          sessionId,
          currentUserEmail
        );

        setBoards((prev) => mergeBoards(prev, data.accessSharedBoard.board));
        setActiveBoardId(data.accessSharedBoard.board.id);
        setActiveShareToken(shareToken);
        setActivePermission(data.accessSharedBoard.permission);
        setStatus(
          data.accessSharedBoard.permission === "edit"
            ? "Shared board opened with edit access"
            : "Shared board opened in read-only mode"
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to open shared board");
      }
    })();
  }, [sessionId, boards.length, currentUserEmail]);

  useEffect(() => {
    if (!sessionId || !activeBoardId) {
      return;
    }

    const subscriptionQuery = `
      subscription NoteUpdated($boardId: ID!, $shareToken: String) {
        noteUpdated(boardId: $boardId, shareToken: $shareToken) {
          id
          boardId
          title
          content
          embeddingPending
        }
      }
    `;

    const queryParam = encodeURIComponent(subscriptionQuery);
    const variablesParam = encodeURIComponent(
      JSON.stringify({ boardId: activeBoardId, shareToken: activeShareToken })
    );
    const sessionParam = encodeURIComponent(sessionId);
    const userEmailParam = currentUserEmail ? `&userEmail=${encodeURIComponent(currentUserEmail)}` : "";

    const eventSource = new EventSource(
      `${GRAPHQL_ENDPOINT}?query=${queryParam}&variables=${variablesParam}&sessionId=${sessionParam}${userEmailParam}`
    );

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { data?: { noteUpdated?: Note } };
        const note = payload.data?.noteUpdated;

        if (!note) {
          return;
        }

        setNotes((prev) => {
          const existingIndex = prev.findIndex((item) => item.id === note.id);

          if (existingIndex === -1) {
            return [note, ...prev];
          }

          const copy = [...prev];
          copy[existingIndex] = note;
          return copy;
        });
      } catch {
        pushToast("error", "Realtime payload parse error");
      }
    };

    eventSource.onerror = () => {
      pushToast("error", "Realtime connection interrupted");
    };

    return () => eventSource.close();
  }, [sessionId, activeBoardId, activeShareToken, currentUserEmail, pushToast]);

  useEffect(() => {
    if (!activeBoardId) {
      return;
    }

    setSelectedId("");
    setDraftTitle("Quick note");
    setDraftContent("Start writing your Synapse note...");
    setSemanticResults(null);
    void loadNotes();
  }, [activeBoardId, activeShareToken, loadNotes]);

  useEffect(() => {
    if (!selectedNote) {
      return;
    }

    setDraftTitle(selectedNote.title);
    setDraftContent(selectedNote.content);
  }, [selectedNote]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setStatus("Manual save shortcut captured. Autosave remains active.");
        pushToast("info", "Autosave is active. Changes sync automatically.");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pushToast]);

  useEffect(() => {
    if (!selectedId || !selectedNote || !canEditBoard) {
      return;
    }

    if (draftTitle === selectedNote.title && draftContent === selectedNote.content) {
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsSaving(true);
      setStatus("Autosaving...");

      try {
        const data = await graphQLRequest<{ updateNote: Note }>(
          `
          mutation UpdateNote($boardId: ID!, $shareToken: String, $id: ID!, $title: String, $content: String) {
            updateNote(boardId: $boardId, shareToken: $shareToken, id: $id, title: $title, content: $content) {
              id
              boardId
              title
              content
              embeddingPending
            }
          }
          `,
          {
            boardId: activeBoardId,
            shareToken: activeShareToken,
            id: selectedId,
            title: draftTitle,
            content: draftContent,
          },
          sessionId,
          currentUserEmail
        );

        const updated = data.updateNote;

        setNotes((prev) => prev.map((note) => (note.id === updated.id ? updated : note)));
        setLastSavedAt(new Date().toLocaleTimeString());
        setStatus("Autosave complete");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Autosave failed");
        pushToast("error", "Autosave failed");
      } finally {
        setIsSaving(false);
      }
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [
    selectedId,
    selectedNote,
    draftTitle,
    draftContent,
    canEditBoard,
    activeBoardId,
    activeShareToken,
    sessionId,
    currentUserEmail,
    pushToast,
  ]);

  const runSemanticSearch = useCallback(
    async (rawQuery: string, mode: "auto" | "manual") => {
      if (!activeBoardId) {
        return;
      }

      const requestId = ++semanticRequestSeqRef.current;
      const query = rawQuery.trim();
      const isManual = mode === "manual";

      if (!query) {
        setSemanticResults(null);
        setStatus("Showing latest notes");
        return;
      }

      if (query.length < 3) {
        setSemanticResults(null);
        if (isManual) {
          setStatus("Type at least 3 characters for semantic search");
        }
        return;
      }

      if (isManual) {
        setIsManualSearching(true);
        setStatus("Running semantic search...");
      }

      try {
        const data = await graphQLRequest<{ semanticSearch: Note[] }>(
          `
          query SemanticSearch($boardId: ID!, $shareToken: String, $query: String!, $limit: Int, $minSimilarity: Float) {
            semanticSearch(boardId: $boardId, shareToken: $shareToken, query: $query, limit: $limit, minSimilarity: $minSimilarity) {
              id
              boardId
              title
              content
              embeddingPending
              semanticScore
            }
          }
          `,
          {
            boardId: activeBoardId,
            shareToken: activeShareToken,
            query,
            limit: 8,
            minSimilarity,
          },
          sessionId,
          currentUserEmail
        );

        if (requestId !== semanticRequestSeqRef.current) {
          return;
        }

        setSemanticResults(data.semanticSearch);
        setStatus(`Semantic search results: ${data.semanticSearch.length}`);
      } catch (error) {
        if (requestId !== semanticRequestSeqRef.current) {
          return;
        }

        setStatus(error instanceof Error ? error.message : "Semantic search failed");
      } finally {
        if (isManual) {
          setIsManualSearching(false);
        }
      }
    },
    [activeBoardId, activeShareToken, minSimilarity, sessionId, currentUserEmail]
  );

  useEffect(() => {
    if (autoSearchDebounceRef.current !== null) {
      window.clearTimeout(autoSearchDebounceRef.current);
    }

    autoSearchDebounceRef.current = window.setTimeout(() => {
      void runSemanticSearch(searchText, "auto");
    }, 450);

    return () => {
      if (autoSearchDebounceRef.current !== null) {
        window.clearTimeout(autoSearchDebounceRef.current);
      }
    };
  }, [searchText, minSimilarity, runSemanticSearch]);

  async function handleCreateBoard(): Promise<void> {
    const name = window.prompt("Board name", "Product roadmap");

    if (!name?.trim()) {
      return;
    }

    setIsCreatingBoard(true);

    try {
      const data = await graphQLRequest<{ createBoard: Board }>(
        `
        mutation CreateBoard($name: String!) {
          createBoard(name: $name) {
            id
            ownerId
            name
            shareToken
            sharePermission
          }
        }
        `,
        { name: name.trim() },
        sessionId,
        currentUserEmail
      );

      setBoards((prev) => [data.createBoard, ...prev]);
      setActiveBoardId(data.createBoard.id);
      setActiveShareToken(null);
      setActivePermission("edit");
      setStatus("Board created");
      pushToast("success", "Board created");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Create board failed");
      pushToast("error", "Unable to create board");
    } finally {
      setIsCreatingBoard(false);
    }
  }

  async function handleDeleteBoard(boardToDelete: Board): Promise<void> {
    if (boardToDelete.ownerId !== sessionId) {
      pushToast("info", "Only board owner can delete this board");
      return;
    }

    const shouldDelete = window.confirm(
      `Delete board \"${boardToDelete.name}\"? This will permanently delete the board and all notes inside it.`
    );

    if (!shouldDelete) {
      return;
    }

    setDeletingBoardId(boardToDelete.id);

    try {
      const data = await graphQLRequest<{ deleteBoard: boolean }>(
        `
        mutation DeleteBoard($id: ID!) {
          deleteBoard(id: $id)
        }
        `,
        { id: boardToDelete.id },
        sessionId,
        currentUserEmail
      );

      if (!data.deleteBoard) {
        throw new Error("Board could not be deleted");
      }

      const nextBoards = boards.filter((board) => board.id !== boardToDelete.id);
      setBoards(nextBoards);

      if (boardToDelete.id === activeBoardId) {
        setSelectedId("");
        setNotes([]);
        setSemanticResults(null);
        setDraftTitle("Quick note");
        setDraftContent("Start writing your Synapse note...");
        setActiveShareToken(null);
        setActivePermission("edit");
        setActiveBoardId(nextBoards[0]?.id ?? "");
      }

      if (nextBoards.length === 0) {
        await loadBoards();
      }

      setStatus("Board deleted");
      pushToast("success", "Board and related notes deleted");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete board failed");
      pushToast("error", "Unable to delete board");
    } finally {
      setDeletingBoardId(null);
    }
  }

  async function handleShareBoard(): Promise<void> {
    if (!activeBoardId || !activeBoard) {
      return;
    }

    if (activeBoard.ownerId !== sessionId) {
      pushToast("info", "Only board owner can regenerate share links");
      return;
    }

    const permissionInput = window.prompt("Share permission: view or edit", "view")?.trim().toLowerCase();

    if (permissionInput !== "view" && permissionInput !== "edit") {
      pushToast("error", "Use permission view or edit");
      return;
    }

    try {
      const data = await graphQLRequest<{ createShareLink: string }>(
        `
        mutation CreateShareLink($boardId: ID!, $permission: BoardPermission!) {
          createShareLink(boardId: $boardId, permission: $permission)
        }
        `,
        {
          boardId: activeBoardId,
          permission: permissionInput,
        },
        sessionId,
        currentUserEmail
      );

      const link = buildShareLink(data.createShareLink);
      await navigator.clipboard.writeText(link);

      setBoards((prev) =>
        prev.map((board) =>
          board.id === activeBoardId
            ? { ...board, shareToken: data.createShareLink, sharePermission: permissionInput }
            : board
        )
      );

      pushToast("success", "Share link copied to clipboard");
      setStatus(`Share link ready (${permissionInput})`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Share link failed");
      pushToast("error", "Unable to create share link");
    }
  }

  async function handleCopyExistingShareLink(): Promise<void> {
    if (!activeBoard?.shareToken) {
      pushToast("info", "This board has no share link yet");
      return;
    }

    try {
      await navigator.clipboard.writeText(buildShareLink(activeBoard.shareToken));
      setStatus("Share link copied again");
      pushToast("success", "Share link copied");
    } catch {
      pushToast("error", "Unable to copy share link");
    }
  }

  async function handleCreateNote(): Promise<void> {
    if (!activeBoardId || !canEditBoard) {
      return;
    }

    setIsCreating(true);
    setStatus("Creating note...");

    try {
      const data = await graphQLRequest<{ createNote: Note }>(
        `
        mutation CreateNote($boardId: ID!, $shareToken: String, $title: String!, $content: String!) {
          createNote(boardId: $boardId, shareToken: $shareToken, title: $title, content: $content) {
            id
            boardId
            title
            content
            embeddingPending
          }
        }
        `,
        {
          boardId: activeBoardId,
          shareToken: activeShareToken,
          title: "Untitled Note",
          content: "",
        },
        sessionId,
        currentUserEmail
      );

      const created = data.createNote;
      setSelectedId(created.id);
      setDraftTitle(created.title);
      setDraftContent(created.content);
      await loadNotes();

      setStatus("Note created");
      pushToast("success", "Note created");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Create failed");
      pushToast("error", "Unable to create note");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeleteSelected(): Promise<void> {
    if (!selectedId || !activeBoardId || !canEditBoard) {
      return;
    }

    setIsDeleting(true);
    setStatus("Deleting note...");

    try {
      const data = await graphQLRequest<{ deleteNote: boolean }>(
        `
        mutation DeleteNote($boardId: ID!, $shareToken: String, $id: ID!) {
          deleteNote(boardId: $boardId, shareToken: $shareToken, id: $id)
        }
        `,
        {
          boardId: activeBoardId,
          shareToken: activeShareToken,
          id: selectedId,
        },
        sessionId,
        currentUserEmail
      );

      if (!data.deleteNote) {
        throw new Error("Unable to delete note");
      }

      const nextNotes = notes.filter((note) => note.id !== selectedId);
      setNotes(nextNotes);
      setSemanticResults(null);

      if (nextNotes.length > 0) {
        setSelectedId(nextNotes[0].id);
      } else {
        setSelectedId("");
        setDraftTitle("");
        setDraftContent("");
      }

      setStatus("Note deleted");
      pushToast("success", "Note deleted");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed");
      pushToast("error", "Delete failed");
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleGrantAccessByEmail(): Promise<void> {
    if (!activeBoard || activeBoard.ownerId !== sessionId) {
      pushToast("info", "Only board owner can grant email access");
      return;
    }

    const email = window.prompt("Collaborator email", "")?.trim().toLowerCase();

    if (!email || !email.includes("@")) {
      pushToast("error", "Please provide a valid email");
      return;
    }

    const permission = window.prompt("Permission: view or edit", "view")?.trim().toLowerCase();

    if (permission !== "view" && permission !== "edit") {
      pushToast("error", "Permission must be view or edit");
      return;
    }

    try {
      await graphQLRequest<{ setBoardCollaborator: { email: string; permission: BoardPermission } }>(
        `
        mutation SetBoardCollaborator($boardId: ID!, $email: String!, $permission: BoardPermission!) {
          setBoardCollaborator(boardId: $boardId, email: $email, permission: $permission) {
            email
            permission
          }
        }
        `,
        {
          boardId: activeBoard.id,
          email,
          permission,
        },
        sessionId,
        currentUserEmail
      );

      pushToast("success", `Access updated for ${email}`);
      setStatus(`Collaborator ${email} -> ${permission}`);
      await loadCollaborators();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to grant access");
      pushToast("error", "Unable to grant access");
    }
  }

  async function handleRemoveCollaborator(email: string): Promise<void> {
    if (!activeBoard || activeBoard.ownerId !== sessionId) {
      return;
    }

    try {
      const data = await graphQLRequest<{ removeBoardCollaborator: boolean }>(
        `
        mutation RemoveBoardCollaborator($boardId: ID!, $email: String!) {
          removeBoardCollaborator(boardId: $boardId, email: $email)
        }
        `,
        {
          boardId: activeBoard.id,
          email,
        },
        sessionId,
        currentUserEmail
      );

      if (!data.removeBoardCollaborator) {
        throw new Error("Collaborator not removed");
      }

      setCollaborators((prev) => prev.filter((item) => item.email !== email));
      pushToast("success", `Removed ${email}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove collaborator");
      pushToast("error", "Unable to remove collaborator");
    }
  }

  const syncBadge = isSaving
    ? "Syncing"
    : status.toLowerCase().includes("failed") || status.toLowerCase().includes("error")
      ? "Issue"
      : "Synced";

  if (isHydratingSession) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Synapse Workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Initializing secure workspace environment...</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!sessionId || !sessionMode) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#040608] p-4 text-white">
        <section className="flex h-[472px] w-full max-w-[400px] flex-col border border-white/10 bg-[#0b0d10] px-[25px] py-[25px]">
          <header className="mx-auto flex w-[350px] flex-col items-center gap-4">
            <div className="grid h-12 w-12 place-items-center border border-white/15 bg-[#090b0e]">
              <div className="grid h-[30px] w-[30px] place-items-center border border-white/10 bg-[#12161b] text-[10px] tracking-[0.1em] text-white/70">
                SY
              </div>
            </div>
            <h1 className="text-center text-[30px] font-normal leading-7 text-white">Synapse Workspace</h1>
          </header>

          <div className="mt-12 flex w-[350px] flex-col gap-6">
            <Button
              className="h-[61px] w-full rounded-none bg-white font-semibold uppercase tracking-[0.18em] text-[#1c1b1b] hover:bg-white/95"
              onClick={handleGuestAccess}
            >
              <span aria-hidden="true" className="text-base">ϟ</span>
              <span className="text-[11px] leading-4">Launch instant demo / guest access</span>
            </Button>

            <div className="flex items-center gap-4 text-[12px] text-[#8f949b]">
              <div className="h-px flex-1 bg-white/10" />
              <span className="whitespace-nowrap">or continue with account</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            {authMode === "login" ? (
              <form id="account-auth-form" className="space-y-4" onSubmit={(event) => void handleSignIn(event)}>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="Email"
                  className="h-[38px] rounded-none border-white/15 bg-transparent px-4 text-sm text-white placeholder:text-[#4f555d]"
                  required
                />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="Password"
                  className="h-[38px] rounded-none border-white/15 bg-transparent px-4 text-sm text-white placeholder:text-[#4f555d]"
                  required
                />
                {authError && <p className="text-sm text-red-300">{authError}</p>}
              </form>
            ) : (
              <form id="account-auth-form" className="space-y-4" onSubmit={(event) => void handleRegister(event)}>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={authName}
                  onChange={(event) => setAuthName(event.target.value)}
                  placeholder="Full name"
                  className="h-[38px] rounded-none border-white/15 bg-transparent px-4 text-sm text-white placeholder:text-[#4f555d]"
                  required
                />
                <Input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="Email"
                  className="h-[38px] rounded-none border-white/15 bg-transparent px-4 text-sm text-white placeholder:text-[#4f555d]"
                  required
                />
                <Input
                  id="register-password"
                  type="password"
                  autoComplete="new-password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="Password"
                  className="h-[38px] rounded-none border-white/15 bg-transparent px-4 text-sm text-white placeholder:text-[#4f555d]"
                  required
                />
                <Input
                  id="register-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={authConfirmPassword}
                  onChange={(event) => setAuthConfirmPassword(event.target.value)}
                  placeholder="Confirm password"
                  className="h-[38px] rounded-none border-white/15 bg-transparent px-4 text-sm text-white placeholder:text-[#4f555d]"
                  required
                />
                {authError && <p className="text-sm text-red-300">{authError}</p>}
              </form>
            )}
          </div>

          <div className="mt-auto flex w-[350px] items-center justify-center gap-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#c9c9c9]">
            <button
              type="button"
              className={authMode === "login" ? "text-white" : "text-[#8f949b]"}
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
            >
              Sign in
            </button>
            <span className="text-[#8f949b]">/</span>
            <button
              type="button"
              className={authMode === "register" ? "text-white" : "text-[#8f949b]"}
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
              }}
            >
              Register
            </button>
            <button form="account-auth-form" type="submit" disabled={isSigningIn} className="sr-only">
              {isSigningIn ? "Processing..." : authMode === "login" ? "Sign in" : "Register"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-black font-mono text-white">
      <header className="flex h-[52px] items-center justify-between border-b border-white/15 bg-[#05070a] px-4">
        <div className="flex items-center gap-3 text-sm font-semibold">
          <div className="grid h-7 w-7 place-items-center border border-white/20 bg-[#0f1217] text-[10px] text-white/70">SY</div>
          <span>Synapse Workspace</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-[#b2b8bf]">
          <a href="#" className="hover:text-white" onClick={(event) => event.preventDefault()}>Docs</a>
          <a href="#" className="hover:text-white" onClick={(event) => event.preventDefault()}>Pricing</a>
          <a href="#" className="hover:text-white" onClick={(event) => event.preventDefault()}>Changelog</a>
          <button type="button" className="border border-white/20 px-4 py-1 text-white/90" onClick={clearSession}>Sign In</button>
          <button type="button" className="bg-white px-4 py-1 font-medium text-black" onClick={handleGuestAccess}>Launch Instant Demo</button>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-52px)] grid-cols-[180px_1fr]">
        <aside className="flex flex-col border-r border-white/15 bg-[#05070a]">
          <div className="p-2">
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between border border-white/20 bg-transparent px-2 text-left text-sm text-[#c4c9d0]"
              onClick={() => setSearchText("")}
            >
              <span>Search...</span>
              <span className="border border-white/20 px-1 text-[10px]">⌘K</span>
            </button>
          </div>

          <p className="px-3 pb-2 text-xs tracking-[0.2em] text-[#7b828b]">WORKSPACES</p>
          <div className="flex-1 space-y-1 overflow-y-auto px-1 pb-4">
            {boards.map((board) => (
              <div key={board.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className={
                    board.id === activeBoardId
                      ? "flex h-9 flex-1 items-center gap-1.5 border border-white/25 bg-[#0f1318] px-2 text-left text-sm text-white"
                      : "flex h-9 flex-1 items-center gap-1.5 border border-transparent px-2 text-left text-sm text-[#a9b0b8] hover:border-white/15"
                  }
                  onClick={() => {
                    setActiveBoardId(board.id);
                    if (board.ownerId === sessionId) {
                      setActiveShareToken(null);
                      setActivePermission("edit");
                    }
                  }}
                >
                  <span className="text-xs">□</span>
                  <span className="truncate">{board.name}</span>
                </button>
                {board.ownerId === sessionId && (
                  <button
                    type="button"
                    className="h-9 w-8 border border-white/20 text-[#efb3af] hover:bg-[#32171b]"
                    onClick={() => void handleDeleteBoard(board)}
                    disabled={deletingBoardId === board.id}
                    aria-label={`Delete board ${board.name}`}
                    title={`Delete board ${board.name}`}
                  >
                    {deletingBoardId === board.id ? "..." : "×"}
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              className="mt-2 flex h-8 w-full items-center gap-2 border border-dashed border-white/15 px-2 text-left text-sm text-[#808790]"
              onClick={() => void handleCreateBoard()}
              disabled={isCreatingBoard}
            >
              <span>+</span>
              <span>{isCreatingBoard ? "Creating..." : "New Board"}</span>
            </button>
          </div>

          <div className="mt-auto border-t border-white/15 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm text-[#d2d7dd]">
              <span className="grid h-6 w-6 place-items-center bg-[#23262b] text-xs">GS</span>
              <div>
                <p>{sessionMode === "user" ? "User Session" : "Guest Session"}</p>
                <p className="text-[11px] text-[#7d838b]">{currentUserEmail || sessionId.slice(0, 12)}</p>
              </div>
            </div>
            <button className="text-sm text-[#9ca3ac] hover:text-white" onClick={clearSession}>Log Out</button>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="flex h-10 items-center justify-between border-b border-white/15 px-4">
            <div className="flex h-8 w-full max-w-[640px] items-center gap-2 border border-white/15 px-2 text-sm text-[#8d949d]">
              <span>⌕</span>
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search boards or notes..."
                className="w-full bg-transparent text-[#d9dee3] outline-none placeholder:text-[#5e6670]"
              />
            </div>
            <div className="ml-4 flex items-center gap-2">
              <button
                type="button"
                className="h-8 w-8 border border-white/20 text-[#9ba2ab]"
                onClick={() => void loadBoards()}
                title="Refresh"
              >
                {isBoardsLoading ? "..." : "⚙"}
              </button>
              <button
                type="button"
                className="h-8 border border-white/20 bg-white px-3 text-sm font-medium text-black disabled:opacity-50"
                onClick={() => void handleShareBoard()}
                disabled={!activeBoard}
              >
                Share Board
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            <p className="text-xl text-[#8a919a]">Project / Workspaces /</p>
            <h2 className="mb-8 text-2xl font-semibold text-white">{activeBoard ? activeBoard.name : "Select a workspace"}</h2>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
              {isLoading && <p className="text-[#94a0ad]">Loading notes...</p>}

              {!isLoading && visibleNotes.map((note) => {
                const preview = (note.content || "No content yet").replace(/\s+/g, " ").trim().slice(0, 150);
                return (
                  <article
                    key={note.id}
                    className={
                      note.id === selectedId
                        ? "flex min-h-[210px] cursor-pointer flex-col border border-white/25 bg-[#0c1015] p-3"
                        : "flex min-h-[210px] cursor-pointer flex-col border border-white/15 bg-[#090d12] p-3"
                    }
                    onClick={() => setSelectedId(note.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="bg-[#262a31] px-2 py-1 text-sm text-[#9ca5af]">{note.embeddingPending ? "draft" : "active"}</span>
                      <span className="text-[#7f8790]">{note.embeddingPending ? "◌" : "◈"}</span>
                    </div>
                    <h3 className="mt-3 text-[28px] leading-none text-white">{note.title || "Untitled"}</h3>
                    <p className="mt-3 text-[30px] leading-8 text-[#b8bec7]">
                      {preview}
                      {(note.content || "").length > 150 ? "..." : ""}
                    </p>
                    <div className="mt-auto flex items-center justify-between border-t border-white/15 pt-3 text-[30px] text-[#8f97a1]">
                      <span>Updated {note.embeddingPending ? "queued" : "live"}</span>
                      <span>
                        {semanticResults && note.semanticScore !== null && note.semanticScore !== undefined
                          ? `${(note.semanticScore * 100).toFixed(1)}%`
                          : "Live"}
                      </span>
                    </div>
                  </article>
                );
              })}

              {!isLoading && canEditBoard && (
                <button
                  type="button"
                  className="grid min-h-[210px] place-items-center border border-white/10 text-[#8e959f] hover:border-white/20"
                  onClick={() => void handleCreateNote()}
                >
                  <div className="text-center">
                    <p className="text-5xl">+</p>
                    <p className="text-2xl">{isCreating ? "Creating..." : "Create New Note"}</p>
                  </div>
                </button>
              )}
            </div>

            {selectedId && (
              <div className="mt-6 border border-white/15 bg-[#090d12] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-[#a8afb8]">
                    <span>{selectedNote?.embeddingPending ? "AI indexing queued" : "AI indexed"}</span>
                    <span>•</span>
                    <span>Last saved: {lastSavedAt || "-"}</span>
                    {!canEditBoard && <span>• Read only</span>}
                  </div>
                  <button
                    type="button"
                    className="border border-[#5f2d34] px-2 py-1 text-xs text-[#efb3af] disabled:opacity-60"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isDeleting || !canEditBoard}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </button>
                </div>

                <input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  placeholder="Note title"
                  disabled={!canEditBoard}
                  className="mb-2 h-9 w-full border border-white/15 bg-transparent px-2 text-sm text-white outline-none placeholder:text-[#5f6771]"
                />

                <div className="border border-white/15 bg-black/40 p-2">
                  <BlockNoteEditorClient
                    noteId={selectedId}
                    markdown={draftContent}
                    editable={canEditBoard}
                    onMarkdownChange={(markdown) => {
                      setDraftContent((prev) => (prev === markdown ? prev : markdown));
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <footer className="flex h-12 items-center justify-between border-t border-white/15 px-4 text-sm text-[#8f97a1]">
            <p>Synapse © 2024 Built for performance.</p>
            <div className="flex gap-6">
              <a href="#" onClick={(event) => event.preventDefault()}>Status</a>
              <a href="#" onClick={(event) => event.preventDefault()}>Privacy</a>
              <a href="#" onClick={(event) => event.preventDefault()}>Terms</a>
              <a href="#" onClick={(event) => event.preventDefault()}>Security</a>
            </div>
          </footer>
        </section>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Delete this note?</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">This action removes the note permanently.</p>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => void handleDeleteSelected()}>
                  Confirm delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="fixed right-4 top-4 grid w-[min(340px,calc(100%-24px))] gap-2">
        {toasts.map((toast) => (
          <Card
            key={toast.id}
            className={
              toast.kind === "success"
                ? "border-emerald-500/40"
                : toast.kind === "error"
                  ? "border-destructive/50"
                  : "border-primary/40"
            }
          >
            <CardContent className="p-3 text-sm">{toast.message}</CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
