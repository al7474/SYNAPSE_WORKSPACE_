"use client";

import { RefreshCw, Share2 } from "lucide-react";
import { NoteEditorPanel } from "@/components/workspace/note-editor-panel";
import { NotesGrid } from "@/components/workspace/notes-grid";
import type { Board, Note } from "@/types/workspace";

type WorkspaceContentProps = {
  searchText: string;
  activeBoard: Board | null;
  visibleNotes: Note[];
  semanticResults: Note[] | null;
  isLoading: boolean;
  isBoardsLoading: boolean;
  canEditBoard: boolean;
  isCreating: boolean;
  selectedId: string;
  selectedNote: Note | null;
  draftTitle: string;
  draftContent: string;
  lastSavedAt: string;
  isDeleting: boolean;
  onSearchTextChange: (value: string) => void;
  onRefreshBoards: () => void | Promise<void>;
  onShareBoard: () => void | Promise<void>;
  onSelectNote: (noteId: string) => void;
  onCreateNote: () => void | Promise<void>;
  onDraftTitleChange: (value: string) => void;
  onDraftContentChange: (value: string) => void;
  onRequestDelete: () => void;
};

export function WorkspaceContent({
  searchText,
  activeBoard,
  visibleNotes,
  semanticResults,
  isLoading,
  isBoardsLoading,
  canEditBoard,
  isCreating,
  selectedId,
  selectedNote,
  draftTitle,
  draftContent,
  lastSavedAt,
  isDeleting,
  onSearchTextChange,
  onRefreshBoards,
  onShareBoard,
  onSelectNote,
  onCreateNote,
  onDraftTitleChange,
  onDraftContentChange,
  onRequestDelete,
}: WorkspaceContentProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        <div className="group mb-4 flex min-h-[17px] items-center justify-between gap-4">
          <p className="min-w-0 truncate text-[11px] uppercase tracking-[0.55px] text-[#a1a1a1]">
            {activeBoard ? activeBoard.name : "Select a board"} / {visibleNotes.length} notes
          </p>
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              className="grid h-7 w-7 place-items-center text-[#a1a1a1] hover:text-[#fafafa]"
              onClick={() => void onRefreshBoards()}
              title="Refresh boards"
              aria-label="Refresh boards"
            >
              {isBoardsLoading ? "..." : <RefreshCw size={14} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="grid h-7 w-7 place-items-center text-[#a1a1a1] hover:text-[#fafafa] disabled:opacity-30"
              onClick={() => void onShareBoard()}
              disabled={!activeBoard}
              title="Share board"
              aria-label="Share board"
            >
              <Share2 size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        <NotesGrid
          notes={visibleNotes}
          semanticResults={semanticResults}
          isLoading={isLoading}
          selectedId={selectedId}
          canEditBoard={canEditBoard}
          isCreating={isCreating}
          onSelectNote={onSelectNote}
          onCreateNote={onCreateNote}
        />

        {selectedId && (
          <NoteEditorPanel
            selectedId={selectedId}
            selectedNote={selectedNote}
            draftTitle={draftTitle}
            draftContent={draftContent}
            lastSavedAt={lastSavedAt}
            canEditBoard={canEditBoard}
            isDeleting={isDeleting}
            onDraftTitleChange={onDraftTitleChange}
            onDraftContentChange={onDraftContentChange}
            onRequestDelete={onRequestDelete}
          />
        )}
      </div>
    </section>
  );
}
