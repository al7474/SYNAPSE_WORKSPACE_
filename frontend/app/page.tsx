"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const [lastSavedAt, setLastSavedAt] = useState<string>("");
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

  const isSharedBoard = useMemo(() => {
    if (!activeBoard) {
      return false;
    }

    return activeBoard.ownerId !== sessionId;
  }, [activeBoard, sessionId]);

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

  async function handleRenameBoard(): Promise<void> {
    if (!activeBoard) {
      return;
    }

    if (activeBoard.ownerId !== sessionId) {
      pushToast("info", "Only board owner can rename this board");
      return;
    }

    const nextName = window.prompt("New board name", activeBoard.name)?.trim();

    if (!nextName) {
      return;
    }

    try {
      const data = await graphQLRequest<{ updateBoard: Board }>(
        `
        mutation UpdateBoard($id: ID!, $name: String!) {
          updateBoard(id: $id, name: $name) {
            id
            ownerId
            name
            shareToken
            sharePermission
          }
        }
        `,
        {
          id: activeBoard.id,
          name: nextName,
        },
        sessionId,
        currentUserEmail
      );

      setBoards((prev) => prev.map((board) => (board.id === data.updateBoard.id ? data.updateBoard : board)));
      setStatus("Board renamed");
      pushToast("success", "Board renamed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Rename failed");
      pushToast("error", "Unable to rename board");
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

      // Reload from server to keep list aligned with current board context.
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
      <main className="auth-shell">
        <section className="auth-card panel">
          <h1>Synapse Workspace</h1>
          <p className="muted">Initializing secure workspace environment...</p>
        </section>
      </main>
    );
  }

  if (!sessionId || !sessionMode) {
    return (
      <main className="auth-shell">
        <section className="auth-card panel">
          <h1>Welcome back</h1>
          <p className="muted">
            {authMode === "login"
              ? "Sign in to continue or enter instantly as a guest."
              : "Create your account in seconds and start building your workspace."}
          </p>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              className={authMode === "login" ? "active" : ""}
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={authMode === "register" ? "active" : ""}
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
              }}
            >
              Create account
            </button>
          </div>

          {authMode === "login" ? (
            <form className="auth-form" onSubmit={(event) => void handleSignIn(event)}>
              <label className="muted" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="you@company.com"
                required
              />

              <label className="muted" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="••••••••"
                required
              />

              {authError && <p className="auth-error">{authError}</p>}

              <button className="btn btn-primary" type="submit" disabled={isSigningIn}>
                {isSigningIn ? "Signing in..." : "Sign in"}
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={(event) => void handleRegister(event)}>
              <label className="muted" htmlFor="name">
                Full name
              </label>
              <input
                id="name"
                className="input"
                type="text"
                autoComplete="name"
                value={authName}
                onChange={(event) => setAuthName(event.target.value)}
                placeholder="Ada Lovelace"
                required
              />

              <label className="muted" htmlFor="register-email">
                Email
              </label>
              <input
                id="register-email"
                className="input"
                type="email"
                autoComplete="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="you@company.com"
                required
              />

              <label className="muted" htmlFor="register-password">
                Password
              </label>
              <input
                id="register-password"
                className="input"
                type="password"
                autoComplete="new-password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="At least 6 characters"
                required
              />

              <label className="muted" htmlFor="register-confirm-password">
                Confirm password
              </label>
              <input
                id="register-confirm-password"
                className="input"
                type="password"
                autoComplete="new-password"
                value={authConfirmPassword}
                onChange={(event) => setAuthConfirmPassword(event.target.value)}
                placeholder="Repeat your password"
                required
              />

              {authError && <p className="auth-error">{authError}</p>}

              <button className="btn btn-primary" type="submit" disabled={isSigningIn}>
                {isSigningIn ? "Creating account..." : "Create account"}
              </button>
            </form>
          )}

          <div className="auth-divider" aria-hidden="true">
            <span>or</span>
          </div>

          <button className="btn" type="button" onClick={handleGuestAccess}>
            Continue as guest
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <h1>Synapse Workspace</h1>
          <p className="muted">
            {activeBoard ? `Board: ${activeBoard.name}` : "Create your first board"} • Session: {sessionMode}
          </p>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {boards.length} board(s) • {notes.length} note(s) in current board
          </p>
        </div>
        <div className="meta-row">
          {isSharedBoard && (
            <span className={`pill ${activePermission === "edit" ? "synced" : "pending"}`}>
              Shared {activePermission}
            </span>
          )}
          <button className="btn" onClick={clearSession}>
            Sign out
          </button>
          <span className="badge">{status}</span>
          <span className={`pill ${syncBadge === "Synced" ? "synced" : ""}`}>{syncBadge}</span>
        </div>
      </header>

      <div className="layout-grid">
        <aside className="panel sidebar">
          <div className="row">
            <button className="btn btn-primary" onClick={() => void handleCreateBoard()} disabled={isCreatingBoard}>
              {isCreatingBoard ? "Creating..." : "New board"}
            </button>
            <button className="btn" onClick={() => void loadBoards()} disabled={isBoardsLoading}>
              {isBoardsLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="note-list" style={{ marginTop: 10, maxHeight: 220 }}>
            {boards.map((board) => (
              <article
                key={board.id}
                className={`note-card ${board.id === activeBoardId ? "active" : ""}`}
                onClick={() => {
                  setActiveBoardId(board.id);

                  if (board.ownerId === sessionId) {
                    setActiveShareToken(null);
                    setActivePermission("edit");
                  }
                }}
              >
                <p className="note-title">{board.name}</p>
                <div className="meta-row">
                  <span className="pill">{board.ownerId === sessionId ? "Owned" : "Shared"}</span>
                  {board.shareToken && <span className="pill">Link ready</span>}
                </div>
              </article>
            ))}
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn"
              onClick={() => void handleRenameBoard()}
              disabled={!activeBoard || activeBoard.ownerId !== sessionId}
            >
              Rename board
            </button>
            <button
              className="btn"
              onClick={() => void handleGrantAccessByEmail()}
              disabled={!activeBoard || activeBoard.ownerId !== sessionId}
            >
              Grant by email
            </button>
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => void handleShareBoard()} disabled={!activeBoard}>
              Share board
            </button>
            <button
              className="btn"
              onClick={() => void handleCopyExistingShareLink()}
              disabled={!activeBoard?.shareToken}
            >
              Copy link again
            </button>
          </div>

          {activeBoard?.shareToken && (
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Share link active ({activeBoard.sharePermission}) • no expiration configured.
            </p>
          )}

          {!activeBoard?.shareToken && (
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Create a share link first. Once created, you can copy it again anytime.
            </p>
          )}

          {activeBoard?.ownerId === sessionId && (
            <div className="collaborators-box">
              <div className="meta-row" style={{ justifyContent: "space-between" }}>
                <strong>Collaborators</strong>
                <button className="btn btn-compact" onClick={() => void loadCollaborators()}>
                  Refresh
                </button>
              </div>

              {isCollaboratorsLoading && <p className="muted" style={{ marginTop: 8 }}>Loading collaborators...</p>}

              {!isCollaboratorsLoading && collaborators.length === 0 && (
                <p className="muted" style={{ marginTop: 8 }}>
                  No collaborators yet.
                </p>
              )}

              {!isCollaboratorsLoading && collaborators.length > 0 && (
                <div className="collaborators-list">
                  {collaborators.map((collaborator) => (
                    <div key={collaborator.email} className="collaborator-item">
                      <div>
                        <p className="note-title" style={{ marginBottom: 2 }}>
                          {collaborator.email}
                        </p>
                        <span className="pill">{collaborator.permission}</span>
                      </div>
                      <button
                        className="btn btn-danger btn-compact"
                        onClick={() => void handleRemoveCollaborator(collaborator.email)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={() => void handleCreateNote()}
              disabled={!activeBoard || !canEditBoard || isCreating}
            >
              {isCreating ? "Creating..." : "New note"}
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            <input
              className="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search inside this board..."
            />
            <div style={{ marginTop: 8 }}>
              <label className="muted" style={{ fontSize: 12 }}>
                Precision threshold: {(minSimilarity * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min={0.15}
                max={0.9}
                step={0.01}
                value={minSimilarity}
                onChange={(event) => setMinSimilarity(Number(event.target.value))}
                style={{ width: "100%" }}
              />
            </div>

            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => void runSemanticSearch(searchText, "manual")} disabled={isManualSearching}>
                {isManualSearching ? "Searching..." : "Search"}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setSearchText("");
                  setSemanticResults(null);
                  setStatus("Showing latest notes");
                }}
              >
                Clear
              </button>
            </div>

            <div style={{ marginTop: 8 }} className="segment">
              <button className={notesFilter === "all" ? "active" : ""} onClick={() => setNotesFilter("all")}>All</button>
              <button className={notesFilter === "indexed" ? "active" : ""} onClick={() => setNotesFilter("indexed")}>Indexed</button>
              <button className={notesFilter === "pending" ? "active" : ""} onClick={() => setNotesFilter("pending")}>Pending</button>
            </div>

            <div style={{ marginTop: 8 }}>
              <button
                className="btn"
                style={{ width: "100%" }}
                disabled={isReindexing || !canEditBoard || !activeBoardId}
                onClick={async () => {
                  if (!activeBoardId) {
                    return;
                  }

                  setIsReindexing(true);
                  setStatus("Retrying pending embeddings...");

                  try {
                    const data = await graphQLRequest<{ reindexPendingEmbeddings: number }>(
                      `
                      mutation ReindexPending($boardId: ID!, $shareToken: String, $limit: Int) {
                        reindexPendingEmbeddings(boardId: $boardId, shareToken: $shareToken, limit: $limit)
                      }
                      `,
                      {
                        boardId: activeBoardId,
                        shareToken: activeShareToken,
                        limit: 40,
                      },
                      sessionId,
                      currentUserEmail
                    );

                    await loadNotes();
                    setStatus(`Reindexed notes: ${data.reindexPendingEmbeddings}`);
                    pushToast("success", `Reindexed ${data.reindexPendingEmbeddings} notes`);
                  } catch (error) {
                    setStatus(error instanceof Error ? error.message : "Reindex failed");
                    pushToast("error", "Reindex failed");
                  } finally {
                    setIsReindexing(false);
                  }
                }}
              >
                {isReindexing ? "Reindexing..." : "Retry Pending Embeddings"}
              </button>
            </div>
          </div>

          <div className="note-list">
            {isLoading && <p className="muted">Loading notes...</p>}
            {!isLoading && visibleNotes.length === 0 && <p className="muted">No notes in this board yet.</p>}

            {visibleNotes.map((note) => (
              <article
                key={note.id}
                className={`note-card ${note.id === selectedId ? "active" : ""}`}
                onClick={() => setSelectedId(note.id)}
              >
                <p className="note-title">{note.title || "Untitled"}</p>
                <div className="meta-row">
                  <span className={`pill ${note.embeddingPending ? "pending" : "synced"}`}>
                    {note.embeddingPending ? "Embedding pending" : "Indexed"}
                  </span>
                  {semanticResults && note.semanticScore !== null && note.semanticScore !== undefined && (
                    <span className="pill">Score {(note.semanticScore * 100).toFixed(1)}%</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </aside>

        <section className="panel editor">
          {!selectedId && <p className="muted">Select or create a note to start writing.</p>}

          {selectedId && (
            <>
              <div className="editor-header">
                <div className="meta-row">
                  <span className="pill">Autosave 2.5s</span>
                  <span className="pill">Last saved: {lastSavedAt || "-"}</span>
                  <span className={`pill ${selectedNote?.embeddingPending ? "pending" : "synced"}`}>
                    {selectedNote?.embeddingPending ? "AI indexing queued" : "AI indexed"}
                  </span>
                  {!canEditBoard && <span className="pill pending">Read only</span>}
                </div>
                <button
                  className="btn btn-danger"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDeleting || !canEditBoard}
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </div>

              <input
                className="input"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="Note title"
                disabled={!canEditBoard}
                style={{ marginBottom: 10 }}
              />

              <textarea
                className="textarea"
                value={draftContent}
                onChange={(event) => setDraftContent(event.target.value)}
                placeholder="Write your note"
                disabled={!canEditBoard}
              />
            </>
          )}
        </section>
      </div>

      {showDeleteConfirm && (
        <div className="modal-backdrop">
          <div className="modal panel">
            <h3 style={{ marginTop: 0 }}>Delete this note?</h3>
            <p className="muted">This action removes the note permanently.</p>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => void handleDeleteSelected()}>
                Confirm delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </main>
  );
}
