"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Note = {
  id: string;
  title: string;
  content: string;
  embeddingPending: boolean;
  semanticScore?: number | null;
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
  sessionId?: string
): Promise<T> {
  if (!sessionId) {
    throw new Error("Guest session not initialized");
  }

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-session-id": sessionId,
    },
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
    setSessionId("");
    setSessionMode(null);
    setNotes([]);
    setSelectedId("");
    setSemanticResults(null);
    setAuthName("");
    setAuthEmail("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthError("");
  }, []);

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

  const loadNotes = useCallback(async () => {
    if (!sessionId) {
      return;
    }

    setIsLoading(true);
    setStatus("Loading notes...");

    try {
      const data = await graphQLRequest<{ listNotes: Note[] }>(`
        query {
          listNotes {
            id
            title
            content
            embeddingPending
            semanticScore
          }
        }
      `, undefined, sessionId);

      setNotes(data.listNotes);
      setSemanticResults(null);

      if (!selectedId && data.listNotes.length > 0) {
        const first = data.listNotes[0];
        setSelectedId(first.id);
        setDraftTitle(first.title);
        setDraftContent(first.content);
      }

      setStatus("Workspace synced");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load notes");
    } finally {
      setIsLoading(false);
    }
  }, [selectedId, sessionId]);

  useEffect(() => {
    const storedSessionId = window.localStorage.getItem(SESSION_ID_KEY)?.trim() || "";
    const storedSessionMode = window.localStorage.getItem(SESSION_MODE_KEY) as SessionMode | null;
    const legacyGuestId = window.localStorage.getItem(LEGACY_GUEST_SESSION_KEY)?.trim() || "";

    if (storedSessionId && (storedSessionMode === "guest" || storedSessionMode === "user")) {
      setSessionId(storedSessionId);
      setSessionMode(storedSessionMode);
    } else if (legacyGuestId) {
      persistSession(legacyGuestId, "guest");
      window.localStorage.removeItem(LEGACY_GUEST_SESSION_KEY);
    }

    setIsHydratingSession(false);
  }, [persistSession]);

  const handleGuestAccess = useCallback(() => {
    const nextGuestSession = createGuestSessionId();
    persistSession(nextGuestSession, "guest");
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

    const subscriptionQuery = `subscription { noteUpdated { id title content embeddingPending } }`;
    const queryParam = encodeURIComponent(subscriptionQuery);
    const sessionParam = encodeURIComponent(sessionId);
    const eventSource = new EventSource(
      `${GRAPHQL_ENDPOINT}?query=${queryParam}&sessionId=${sessionParam}`
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

        if (note.id === selectedId) {
          const hasUnsavedChanges =
            (selectedNote?.title ?? "") !== draftTitle ||
            (selectedNote?.content ?? "") !== draftContent;

          if (!hasUnsavedChanges) {
            setDraftTitle(note.title);
            setDraftContent(note.content);
          }
        }
      } catch {
        pushToast("error", "Realtime payload parse error");
      }
    };

    eventSource.onerror = () => {
      pushToast("error", "Realtime connection interrupted");
    };

    return () => {
      eventSource.close();
    };
  }, [selectedId, selectedNote, draftTitle, draftContent, pushToast, sessionId]);

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
    if (!sessionId) {
      return;
    }

    void loadNotes();
  }, [loadNotes, sessionId]);

  useEffect(() => {
    if (!selectedNote) {
      return;
    }

    setDraftTitle(selectedNote.title);
    setDraftContent(selectedNote.content);
  }, [selectedNote]);

  useEffect(() => {
    if (!selectedId || !selectedNote) {
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
          mutation UpdateNote($id: ID!, $title: String, $content: String) {
            updateNote(id: $id, title: $title, content: $content) {
              id
              title
              content
              embeddingPending
            }
          }
          `,
          {
            id: selectedId,
            title: draftTitle,
            content: draftContent,
          },
          sessionId
        );

        const updated = data.updateNote;

        setNotes((prev) => prev.map((note) => (note.id === updated.id ? updated : note)));
        setLastSavedAt(new Date().toLocaleTimeString());
        setStatus("Autosave complete");
        pushToast("success", "Note saved");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Autosave failed");
        pushToast("error", "Autosave failed");
      } finally {
        setIsSaving(false);
      }
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [draftContent, draftTitle, selectedId, selectedNote, pushToast, sessionId]);

  async function handleCreateNote(): Promise<void> {
    setIsCreating(true);
    setStatus("Creating note...");

    try {
      const data = await graphQLRequest<{ createNote: Note }>(`
        mutation {
          createNote(title: "Untitled Note", content: "") {
            id
            title
            content
            embeddingPending
          }
        }
      `, undefined, sessionId);

      const created = data.createNote;
      setNotes((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setDraftTitle(created.title);
      setDraftContent(created.content);
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
    if (!selectedId) {
      return;
    }

    setIsDeleting(true);
    setStatus("Deleting note...");

    try {
      const data = await graphQLRequest<{ deleteNote: boolean }>(
        `
        mutation DeleteNote($id: ID!) {
          deleteNote(id: $id)
        }
        `,
        { id: selectedId },
        sessionId
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

  const runSemanticSearch = useCallback(
    async (rawQuery: string, mode: "auto" | "manual") => {
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
          query SemanticSearch($query: String!, $limit: Int, $minSimilarity: Float) {
            semanticSearch(query: $query, limit: $limit, minSimilarity: $minSimilarity) {
              id
              title
              content
              embeddingPending
              semanticScore
            }
          }
          `,
          { query, limit: 8, minSimilarity },
          sessionId
        );

        if (requestId !== semanticRequestSeqRef.current) {
          return;
        }

        let finalResults = data.semanticSearch;
        let usedFallback = false;

        if (finalResults.length === 0) {
          const relaxedThreshold = Math.max(0.15, minSimilarity - 0.22);

          if (relaxedThreshold < minSimilarity) {
            const relaxed = await graphQLRequest<{ semanticSearch: Note[] }>(
              `
              query SemanticSearch($query: String!, $limit: Int, $minSimilarity: Float) {
                semanticSearch(query: $query, limit: $limit, minSimilarity: $minSimilarity) {
                  id
                  title
                  content
                  embeddingPending
                  semanticScore
                }
              }
              `,
              { query, limit: 8, minSimilarity: relaxedThreshold },
              sessionId
            );

            if (requestId !== semanticRequestSeqRef.current) {
              return;
            }

            if (relaxed.semanticSearch.length > 0) {
              finalResults = relaxed.semanticSearch;
              usedFallback = true;
            }
          }
        }

        setSemanticResults(finalResults);
        setStatus(
          usedFallback
            ? `No strict matches. Showing broader results: ${finalResults.length}`
            : `Semantic search results: ${finalResults.length}`
        );

        if (isManual) {
          pushToast("success", "Semantic search complete");
        }
      } catch (error) {
        if (requestId !== semanticRequestSeqRef.current) {
          return;
        }

        setStatus(error instanceof Error ? error.message : "Semantic search failed");

        if (isManual) {
          pushToast("error", "Semantic search failed");
        }
      } finally {
        if (isManual) {
          setIsManualSearching(false);
        }
      }
    },
    [minSimilarity, pushToast, sessionId]
  );

  async function handleSemanticSearch(): Promise<void> {
    await runSemanticSearch(searchText, "manual");
  }

  useEffect(() => {
    if (autoSearchDebounceRef.current !== null) {
      window.clearTimeout(autoSearchDebounceRef.current);
    }

    autoSearchDebounceRef.current = window.setTimeout(() => {
      void runSemanticSearch(searchText, "auto");
    }, 500);

    return () => {
      if (autoSearchDebounceRef.current !== null) {
        window.clearTimeout(autoSearchDebounceRef.current);
      }
    };
  }, [searchText, minSimilarity, runSemanticSearch]);

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
            A dark, realtime notebook with semantic memory. Session: {sessionMode === "guest" ? "Guest" : "User"}
          </p>
        </div>
        <div className="meta-row">
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
            <button className="btn btn-primary" onClick={() => void handleCreateNote()} disabled={isCreating}>
              {isCreating ? "Creating..." : "New"}
            </button>
            <button className="btn" onClick={() => void loadNotes()}>
              Refresh
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            <input
              className="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Semantic search: docker, deploy, auth..."
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
              <button className="btn" onClick={() => void handleSemanticSearch()} disabled={isManualSearching}>
                {isManualSearching ? "Searching..." : "Search"}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setSearchText("");
                  setSemanticResults(null);
                  void loadNotes();
                  setStatus("Showing latest notes");
                }}
              >
                Clear
              </button>
            </div>
            <div style={{ marginTop: 8 }} className="segment">
              <button
                className={notesFilter === "all" ? "active" : ""}
                onClick={() => setNotesFilter("all")}
              >
                All
              </button>
              <button
                className={notesFilter === "indexed" ? "active" : ""}
                onClick={() => setNotesFilter("indexed")}
              >
                Indexed
              </button>
              <button
                className={notesFilter === "pending" ? "active" : ""}
                onClick={() => setNotesFilter("pending")}
              >
                Pending
              </button>
            </div>
            <div style={{ marginTop: 8 }}>
              <button
                className="btn"
                style={{ width: "100%" }}
                onClick={async () => {
                  setIsReindexing(true);
                  setStatus("Retrying pending embeddings...");

                  try {
                    const data = await graphQLRequest<{ reindexPendingEmbeddings: number }>(
                      `
                      mutation ReindexPending($limit: Int) {
                        reindexPendingEmbeddings(limit: $limit)
                      }
                      `,
                      { limit: 40 },
                      sessionId
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
                disabled={isReindexing}
              >
                {isReindexing ? "Reindexing..." : "Retry Pending Embeddings"}
              </button>
            </div>
          </div>

          <div className="note-list">
            {isLoading && <p className="muted">Loading notes...</p>}
            {!isLoading && visibleNotes.length === 0 && (
              <p className="muted">{semanticResults ? "No semantic matches" : "No notes yet."}</p>
            )}

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
                </div>
                <button
                  className="btn btn-danger"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </div>

              <input
                className="input"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="Note title"
                style={{ marginBottom: 10 }}
              />

              <textarea
                className="textarea"
                value={draftContent}
                onChange={(event) => setDraftContent(event.target.value)}
                placeholder="Write your note"
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
