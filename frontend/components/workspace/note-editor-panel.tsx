"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="note-editor-surface flex min-h-0 min-w-0 flex-1 flex-col border border-border-strong p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2 text-label uppercase tracking-label-lg text-muted-foreground">Note editor</p>
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-strong">
            <span>{selectedNote?.embeddingPending ? "AI indexing queued" : "AI indexed"}</span>
            <span>•</span>
            <span data-testid="autosave-status">Last saved: {lastSavedAt || "-"}</span>
            {!canEditBoard && <span>• Read only</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="unstyled"
            type="button"
            className="border border-danger-border px-3 py-1.5 text-xs text-danger-soft disabled:opacity-60"
            onClick={onRequestDelete}
            disabled={isDeleting || !canEditBoard}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
          <Button variant="unstyled"
            type="button"
            className="grid h-8 w-8 place-items-center border border-border-strong text-muted-foreground hover:border-neutral-strong hover:text-foreground"
            onClick={onClose}
            title="Close note and return to board"
            aria-label="Close note and return to board"
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>

      <Input variant="unstyled"
        value={draftTitle}
        onChange={(event) => onDraftTitleChange(event.target.value)}
        placeholder="Note title"
        disabled={!canEditBoard}
        autoFocus
        aria-label="Note title"
        className="note-editor-field mb-4 h-14 min-w-0 w-full border border-border-strong px-4 text-xl font-medium text-bright outline-none placeholder:text-placeholder-muted focus:border-focus-muted sm:text-2xl"
      />

      <div
        className="note-editor-field min-h-80 min-w-0 flex-1 overflow-y-auto border border-border-strong text-sm leading-6 text-bright"
        aria-label="Note description"
      >
        {selectedNote && (
          <BlockNoteEditorClient
            key={selectedNote.id}
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
