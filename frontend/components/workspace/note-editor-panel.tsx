"use client";

import { X } from "lucide-react";
import { BlockNoteEditorClient } from "@/components/editor/blocknote-editor-client";
import type { Note } from "@/types/workspace";

type NoteEditorPanelProps = {
  selectedNote: Note | null;
  draftTitle: string;
  draftContent: string;
  lastSavedAt: string;
  canEditBoard: boolean;
  isDeleting: boolean;
  onDraftTitleChange: (value: string) => void;
  onDraftContentChange: (value: string) => void;
  onRequestDelete: () => void;
  onClose: () => void;
};

export function NoteEditorPanel({
  selectedNote,
  draftTitle,
  draftContent,
  lastSavedAt,
  canEditBoard,
  isDeleting,
  onDraftTitleChange,
  onDraftContentChange,
  onRequestDelete,
  onClose,
}: NoteEditorPanelProps) {
  return (
    <div className="note-editor-surface flex min-h-0 min-w-0 flex-1 flex-col border border-[#484848] p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2 text-[11px] uppercase tracking-[0.55px] text-[#a1a1a1]">Note editor</p>
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-[#a3a3a3]">
            <span>{selectedNote?.embeddingPending ? "AI indexing queued" : "AI indexed"}</span>
            <span>•</span>
            <span data-testid="autosave-status">Last saved: {lastSavedAt || "-"}</span>
            {!canEditBoard && <span>• Read only</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="border border-[#6a3038] px-3 py-1.5 text-xs text-[#efb3af] disabled:opacity-60"
            onClick={onRequestDelete}
            disabled={isDeleting || !canEditBoard}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center border border-[#484848] text-[#a1a1a1] hover:border-[#8a8a8a] hover:text-[#fafafa]"
            onClick={onClose}
            title="Close note and return to board"
            aria-label="Close note and return to board"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <input
        value={draftTitle}
        onChange={(event) => onDraftTitleChange(event.target.value)}
        placeholder="Note title"
        disabled={!canEditBoard}
        autoFocus
        aria-label="Note title"
        className="note-editor-field mb-4 h-14 min-w-0 w-full border border-[#484848] px-4 text-xl font-medium text-white outline-none placeholder:text-[#707070] focus:border-[#b0b0b0] sm:text-2xl"
      />

      <div
        className="note-editor-field min-h-80 min-w-0 flex-1 overflow-y-auto border border-[#484848] text-sm leading-6 text-white"
        aria-label="Note description"
      >
        {selectedNote && (
          <BlockNoteEditorClient
            noteId={selectedNote.id}
            markdown={draftContent}
            editable={canEditBoard}
            onMarkdownChange={onDraftContentChange}
          />
        )}
      </div>
    </div>
  );
}
