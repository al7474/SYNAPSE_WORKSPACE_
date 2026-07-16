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

const GRAPHQL_ENDPOINT =
  process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT || "http://localhost:4000/graphql";

async function graphQLRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
      `);

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
  }, [selectedId]);

  useEffect(() => {
    const subscriptionQuery = `subscription { noteUpdated { id title content embeddingPending } }`;
    const queryParam = encodeURIComponent(subscriptionQuery);
    const eventSource = new EventSource(`${GRAPHQL_ENDPOINT}?query=${queryParam}`);

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
  }, [selectedId, selectedNote, draftTitle, draftContent, pushToast]);

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
    void loadNotes();
  }, [loadNotes]);

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
          }
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
  }, [draftContent, draftTitle, selectedId, selectedNote, pushToast]);

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
      `);

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
        { id: selectedId }
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
          { query, limit: 8, minSimilarity }
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
              { query, limit: 8, minSimilarity: relaxedThreshold }
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
    [minSimilarity, pushToast]
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

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <h1>Synapse Workspace</h1>
          <p className="muted">A dark, realtime notebook with semantic memory.</p>
        </div>
        <div className="meta-row">
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
                      { limit: 40 }
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
