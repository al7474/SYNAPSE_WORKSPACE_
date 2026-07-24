"use client";

import { RefreshCw } from "lucide-react";
import { BoardAccessPanel } from "@/components/workspace/board-access-panel";
import { NoteEditorPanel } from "@/components/workspace/note-editor-panel";
import { NotesGrid } from "@/components/workspace/notes-grid";
import type { Board, BoardCollaborator, BoardPermission, Note } from "@/types/workspace";

type WorkspaceContentProps = {
  searchText: string;
  activeBoard: Board | null;
  currentUserEmail: string | null;
  showBoardAccess: boolean;
  collaborators: BoardCollaborator[];
  isCollaboratorsLoading: boolean;
  collaboratorActionEmail: string | null;
  visibleNotes: Note[];
  semanticResults: Note[] | null;
  isLoading: boolean;
  isBoardsLoading: boolean;
  canEditBoard: boolean;
  isCreating: boolean;
  isNoteEditorOpen: boolean;
  selectedId: string;
  selectedNote: Note | null;
  draftTitle: string;
  draftContent: string;
  lastSavedAt: string;
  isDeleting: boolean;
  onSearchTextChange: (value: string) => void;
  onRefreshBoards: () => void | Promise<void>;
  onCloseBoardAccess: () => void;
  onUpdateCollaboratorPermission: (email: string, permission: BoardPermission) => void | Promise<void>;
  onRemoveCollaborator: (email: string) => void | Promise<void>;
  onSelectNote: (noteId: string) => void;
  onCreateNote: () => void | Promise<void>;
  onCloseNote: () => void;
  onDraftTitleChange: (value: string) => void;
  onDraftContentChange: (value: string) => void;
  onRequestDelete: () => void;
};

export function WorkspaceContent({
  searchText,
  activeBoard,
  currentUserEmail,
  showBoardAccess,
  collaborators,
  isCollaboratorsLoading,
  collaboratorActionEmail,
  visibleNotes,
  semanticResults,
  isLoading,
  isBoardsLoading,
  canEditBoard,
  isCreating,
  isNoteEditorOpen,
  selectedId,
  selectedNote,
  draftTitle,
  draftContent,
  lastSavedAt,
  isDeleting,
  onSearchTextChange,
  onRefreshBoards,
  onCloseBoardAccess,
  onUpdateCollaboratorPermission,
  onRemoveCollaborator,
  onSelectNote,
  onCreateNote,
  onCloseNote,
  onDraftTitleChange,
  onDraftContentChange,
  onRequestDelete,
}: WorkspaceContentProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={isNoteEditorOpen ? "flex min-w-0 flex-1 flex-col overflow-y-auto p-4" : "min-w-0 flex-1 overflow-y-auto p-4"}>
        {!isNoteEditorOpen && (
          <div className="group mb-4 flex min-h-4.25 items-center justify-between gap-4">
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
            </div>
          </div>
        )}

        {showBoardAccess && activeBoard && (
          <BoardAccessPanel
            board={activeBoard}
            currentUserEmail={currentUserEmail}
            collaborators={collaborators}
            isLoading={isCollaboratorsLoading}
            collaboratorActionEmail={collaboratorActionEmail}
            onClose={onCloseBoardAccess}
            onUpdatePermission={onUpdateCollaboratorPermission}
            onRemoveCollaborator={onRemoveCollaborator}
          />
        )}

        {!showBoardAccess && (
          isNoteEditorOpen && selectedId ? (
            <NoteEditorPanel
              selectedNote={selectedNote}
              draftTitle={draftTitle}
              draftContent={draftContent}
              lastSavedAt={lastSavedAt}
              canEditBoard={canEditBoard}
              isDeleting={isDeleting}
              onDraftTitleChange={onDraftTitleChange}
              onDraftContentChange={onDraftContentChange}
              onRequestDelete={onRequestDelete}
              onClose={onCloseNote}
            />
          ) : (
            <NotesGrid
              notes={visibleNotes}
              semanticResults={semanticResults}
              isLoading={isLoading}
              selectedId=""
              canEditBoard={canEditBoard}
              isCreating={isCreating}
              onSelectNote={onSelectNote}
              onCreateNote={onCreateNote}
            />
          )
        )}
      </div>
    </section>
  );
}
