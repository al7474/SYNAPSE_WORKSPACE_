"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildNoteSubscriptionUrl, graphQLRequest } from "@/lib/graphql-client";
import type { Note, NotesFilter, ToastKind } from "@/types/workspace";

type UseNotesOptions = {
  sessionId: string;
  activeBoardId: string;
  activeShareToken: string | null;
  canEditBoard: boolean;
  onStatusChange: (status: string) => void;
  pushToast: (kind: ToastKind, message: string) => void;
};

export function useNotes({
  sessionId,
  activeBoardId,
  activeShareToken,
  canEditBoard,
  onStatusChange,
  pushToast,
}: UseNotesOptions) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draftTitle, setDraftTitle] = useState("Quick note");
  const [draftContent, setDraftContent] = useState("Start writing your Synapse note...");
  const [searchText, setSearchText] = useState("");
  const [minSimilarity, setMinSimilarity] = useState(0.62);
  const [notesFilter, setNotesFilter] = useState<NotesFilter>("all");
  const [isManualSearching, setIsManualSearching] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [semanticResults, setSemanticResults] = useState<Note[] | null>(null);

  const autoSearchDebounceRef = useRef<number | null>(null);
  const semanticRequestSeqRef = useRef(0);

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

  const visibleNotes = useMemo(
    () => semanticResults || filteredNotes,
    [filteredNotes, semanticResults]
  );

  const loadNotes = useCallback(async () => {
    if (!sessionId || !activeBoardId) {
      return;
    }

    setIsLoading(true);
    onStatusChange("Loading notes...");

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
        { boardId: activeBoardId, shareToken: activeShareToken }
      );

      setNotes(data.listNotes);
      setSemanticResults(null);
      setSelectedId((previousSelectedId) => previousSelectedId || data.listNotes[0]?.id || "");
      onStatusChange("Workspace synced");
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Failed to load notes");
    } finally {
      setIsLoading(false);
    }
  }, [activeBoardId, activeShareToken, onStatusChange, sessionId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (!sessionId || !activeBoardId) {
      return;
    }

    const eventSource = new EventSource(
      buildNoteSubscriptionUrl(activeBoardId, activeShareToken),
      { withCredentials: true }
    );

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { data?: { noteUpdated?: Note } };
        const note = payload.data?.noteUpdated;

        if (!note) {
          return;
        }

        setNotes((previousNotes) => {
          const existingIndex = previousNotes.findIndex((item) => item.id === note.id);

          if (existingIndex === -1) {
            return [note, ...previousNotes];
          }

          const nextNotes = [...previousNotes];
          nextNotes[existingIndex] = note;
          return nextNotes;
        });
      } catch {
        pushToast("error", "Realtime payload parse error");
      }
    };

    eventSource.onerror = () => {
      pushToast("error", "Realtime connection interrupted");
    };

    return () => eventSource.close();
  }, [activeBoardId, activeShareToken, pushToast, sessionId]);

  useEffect(() => {
    if (!activeBoardId) {
      return;
    }

    setSelectedId("");
    setDraftTitle("Quick note");
    setDraftContent("Start writing your Synapse note...");
    setSemanticResults(null);
  }, [activeBoardId, activeShareToken]);

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
        onStatusChange("Manual save shortcut captured. Autosave remains active.");
        pushToast("info", "Autosave is active. Changes sync automatically.");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onStatusChange, pushToast]);

  useEffect(() => {
    if (!selectedId || !selectedNote || !canEditBoard) {
      return;
    }

    if (draftTitle === selectedNote.title && draftContent === selectedNote.content) {
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsSaving(true);
      onStatusChange("Autosaving...");

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
          }
        );

        const updatedNote = data.updateNote;
        setNotes((previousNotes) =>
          previousNotes.map((note) => (note.id === updatedNote.id ? updatedNote : note))
        );
        setLastSavedAt(new Date().toLocaleTimeString());
        onStatusChange("Autosave complete");
      } catch (error) {
        onStatusChange(error instanceof Error ? error.message : "Autosave failed");
        pushToast("error", "Autosave failed");
      } finally {
        setIsSaving(false);
      }
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [
    activeBoardId,
    activeShareToken,
    canEditBoard,
    draftContent,
    draftTitle,
    onStatusChange,
    pushToast,
    selectedId,
    selectedNote,
    sessionId,
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
        onStatusChange("Showing latest notes");
        return;
      }

      if (query.length < 3) {
        setSemanticResults(null);
        if (isManual) {
          onStatusChange("Type at least 3 characters for semantic search");
        }
        return;
      }

      if (isManual) {
        setIsManualSearching(true);
        onStatusChange("Running semantic search...");
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
          }
        );

        if (requestId !== semanticRequestSeqRef.current) {
          return;
        }

        setSemanticResults(data.semanticSearch);
        onStatusChange(`Semantic search results: ${data.semanticSearch.length}`);
      } catch (error) {
        if (requestId !== semanticRequestSeqRef.current) {
          return;
        }

        onStatusChange(error instanceof Error ? error.message : "Semantic search failed");
      } finally {
        if (isManual) {
          setIsManualSearching(false);
        }
      }
    },
    [activeBoardId, activeShareToken, minSimilarity, onStatusChange, sessionId]
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
  }, [minSimilarity, runSemanticSearch, searchText]);

  const handleCreateNote = useCallback(async (): Promise<boolean> => {
    if (!activeBoardId || !canEditBoard) {
      return false;
    }

    setIsCreating(true);
    onStatusChange("Creating note...");

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
        }
      );

      const createdNote = data.createNote;
      setSelectedId(createdNote.id);
      setDraftTitle(createdNote.title);
      setDraftContent(createdNote.content);
      await loadNotes();
      onStatusChange("Note created");
      pushToast("success", "Note created");
      return true;
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Create failed");
      pushToast("error", "Unable to create note");
      return false;
    } finally {
      setIsCreating(false);
    }
  }, [
    activeBoardId,
    activeShareToken,
    canEditBoard,
    loadNotes,
    onStatusChange,
    pushToast,
    sessionId,
  ]);

  const handleDeleteSelected = useCallback(async () => {
    if (!selectedId || !activeBoardId || !canEditBoard) {
      return;
    }

    setIsDeleting(true);
    onStatusChange("Deleting note...");

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
        }
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

      onStatusChange("Note deleted");
      pushToast("success", "Note deleted");
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Delete failed");
      pushToast("error", "Delete failed");
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [
    activeBoardId,
    activeShareToken,
    canEditBoard,
    notes,
    onStatusChange,
    pushToast,
    selectedId,
    sessionId,
  ]);

  const resetNotes = useCallback(() => {
    setNotes([]);
    setSelectedId("");
    setDraftTitle("Quick note");
    setDraftContent("Start writing your Synapse note...");
    setSemanticResults(null);
    setShowDeleteConfirm(false);
  }, []);

  return {
    notes,
    visibleNotes,
    selectedId,
    selectedNote,
    draftTitle,
    draftContent,
    searchText,
    minSimilarity,
    notesFilter,
    semanticResults,
    isManualSearching,
    isDeleting,
    isLoading,
    isCreating,
    isSaving,
    showDeleteConfirm,
    lastSavedAt,
    setSelectedId,
    setDraftTitle,
    setDraftContent,
    setSearchText,
    setMinSimilarity,
    setNotesFilter,
    setShowDeleteConfirm,
    loadNotes,
    runSemanticSearch,
    handleCreateNote,
    handleDeleteSelected,
    resetNotes,
  };
}
