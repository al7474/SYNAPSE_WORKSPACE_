"use client";

import { Search, Settings } from "lucide-react";
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
      <div className="flex min-h-14 flex-wrap items-center gap-3 border-b border-[#444748] px-3 py-3 sm:px-6 sm:py-2">
        <div className="flex h-10 w-full min-w-0 flex-1 items-center gap-3 border border-[#2f3131] bg-black px-3 sm:w-auto">
          <Search size={18} className="text-[#8e9192]" />
          <input
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
            placeholder="Search boards or notes..."
            className="min-w-0 w-full bg-transparent text-base text-white outline-none placeholder:text-[#444748]"
          />
        </div>
        <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto sm:gap-4">
          <button
            type="button"
            className="grid h-9 w-9 place-items-center text-[#8e9192]"
            onClick={() => void onRefreshBoards()}
            title="Refresh boards"
          >
            {isBoardsLoading ? "..." : <Settings size={18} />}
          </button>
          <button
            type="button"
            className="h-8 whitespace-nowrap border border-[#c4c7c8] bg-white px-3 text-xs font-medium text-[#2f3131] disabled:opacity-50 sm:px-4 sm:text-sm"
            onClick={() => void onShareBoard()}
            disabled={!activeBoard}
          >
            Share Board
          </button>
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">
        <p className="text-base text-[#8e9192]">Project / Workspaces /</p>
        <h2 className="mb-6 mt-1 break-words text-xl text-white sm:mb-8 sm:text-2xl">
          {activeBoard ? activeBoard.name : "Select a workspace"}
        </h2>

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

      <footer className="flex min-h-[57px] flex-col items-start justify-center gap-2 border-t border-[#444748] px-3 py-4 text-xs text-[#8e9192] sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0 sm:text-sm">
        <p>
          <strong>Synapse</strong> © 2026 Built for performance.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <a href="#" onClick={(event) => event.preventDefault()}>Status</a>
          <a href="#" onClick={(event) => event.preventDefault()}>Privacy</a>
          <a href="#" onClick={(event) => event.preventDefault()}>Terms</a>
          <a href="#" onClick={(event) => event.preventDefault()}>Security</a>
        </div>
      </footer>
    </section>
  );
}
