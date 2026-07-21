"use client";

import dynamic from "next/dynamic";
import type { Note } from "@/types/workspace";

const BlockNoteEditorClient = dynamic(
  () => import("@/components/editor/blocknote-editor-client").then((module) => module.BlockNoteEditorClient),
  { ssr: false }
);

type NoteEditorPanelProps = {
  selectedId: string;
  selectedNote: Note | null;
  draftTitle: string;
  draftContent: string;
  lastSavedAt: string;
  canEditBoard: boolean;
  isDeleting: boolean;
  onDraftTitleChange: (value: string) => void;
  onDraftContentChange: (value: string) => void;
  onRequestDelete: () => void;
};

export function NoteEditorPanel({
  selectedId,
  selectedNote,
  draftTitle,
  draftContent,
  lastSavedAt,
  canEditBoard,
  isDeleting,
  onDraftTitleChange,
  onDraftContentChange,
  onRequestDelete,
}: NoteEditorPanelProps) {
  return (
    <div className="mt-5 min-w-0 border border-[#444748] bg-[#0e0e0e] p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-[#9aa7bf]">
          <span>{selectedNote?.embeddingPending ? "AI indexing queued" : "AI indexed"}</span>
          <span>•</span>
          <span>Last saved: {lastSavedAt || "-"}</span>
          {!canEditBoard && <span>• Read only</span>}
        </div>
        <button
          type="button"
          className="shrink-0 border border-[#6a3038] px-3 py-1 text-xs text-[#efb3af] disabled:opacity-60"
          onClick={onRequestDelete}
          disabled={isDeleting || !canEditBoard}
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </button>
      </div>

      <input
        value={draftTitle}
        onChange={(event) => onDraftTitleChange(event.target.value)}
        placeholder="Note title"
        disabled={!canEditBoard}
        className="mb-2 h-10 min-w-0 w-full border border-[#444748] bg-[#090b10] px-3 text-sm text-white outline-none placeholder:text-[#5f6771]"
      />

      <div className="min-w-0 overflow-hidden border border-[#444748] bg-[#090b10] p-2">
        <BlockNoteEditorClient
          noteId={selectedId}
          markdown={draftContent}
          editable={canEditBoard}
          onMarkdownChange={onDraftContentChange}
        />
      </div>
    </div>
  );
}
