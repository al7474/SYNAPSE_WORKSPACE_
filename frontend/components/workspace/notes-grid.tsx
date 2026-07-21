"use client";

import { Plus } from "lucide-react";
import type { Note } from "@/types/workspace";

type NotesGridProps = {
  notes: Note[];
  semanticResults: Note[] | null;
  isLoading: boolean;
  selectedId: string;
  canEditBoard: boolean;
  isCreating: boolean;
  onSelectNote: (noteId: string) => void;
  onCreateNote: () => void | Promise<void>;
};

export function NotesGrid({
  notes,
  semanticResults,
  isLoading,
  selectedId,
  canEditBoard,
  isCreating,
  onSelectNote,
  onCreateNote,
}: NotesGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {!isLoading && canEditBoard && (
        <button
          type="button"
          className="grid aspect-square min-h-45 place-items-center border border-dashed border-[rgba(255,255,255,0.1)] bg-transparent text-[#a1a1a1] hover:border-[#737373]"
          onClick={() => void onCreateNote()}
          disabled={isCreating}
        >
          <div className="text-center">
            <Plus size={24} className="mx-auto mb-2" aria-hidden="true" />
            <p className="text-[11px] uppercase tracking-[0.55px]">{isCreating ? "Creating..." : "Create New Note"}</p>
          </div>
        </button>
      )}

      {isLoading && <p className="text-xs uppercase tracking-[0.55px] text-[#a1a1a1]">Loading notes...</p>}

      {!isLoading && notes.map((note) => {
        const preview = (note.content || "No content yet").replace(/\s+/g, " ").trim().slice(0, 160);
        const isIndexed = !note.embeddingPending;

        return (
          <article
            key={note.id}
            className={
              note.id === selectedId
                ? "flex aspect-square min-h-45 min-w-0 cursor-pointer flex-col overflow-hidden border border-[#737373] bg-[rgba(23,23,23,0.4)] p-4.25 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
                : "flex aspect-square min-h-45 min-w-0 cursor-pointer flex-col overflow-hidden border border-[rgba(255,255,255,0.1)] bg-[rgba(23,23,23,0.4)] p-4.25 hover:border-[#737373]"
            }
            onClick={() => onSelectNote(note.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectNote(note.id);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <h3 className="min-w-0 truncate text-xs uppercase tracking-[0.6px] text-[#fafafa]">
                {note.title || "Untitled"}
              </h3>
              <span
                className={isIndexed ? "mt-0.5 h-3 w-3 shrink-0 bg-[#43c251]" : "mt-0.5 h-3 w-3 shrink-0 bg-[#f52f39]"}
                aria-label={isIndexed ? "Indexed note" : "Note indexing pending"}
              />
            </div>

            <p className="mt-3 line-clamp-4 text-xs leading-[19.5px] text-[#a1a1a1]">
              {preview}
              {(note.content || "").length > 160 ? "..." : ""}
            </p>
            <div className="mt-auto flex items-center justify-between border-t border-[rgba(255,255,255,0.1)] pt-3.25 text-[10px] uppercase tracking-[0.5px] text-[#a1a1a1]">
              <span>{note.embeddingPending ? "Index pending" : "Updated recently"}</span>
              <span>
                {semanticResults && note.semanticScore !== null && note.semanticScore !== undefined
                  ? `${(note.semanticScore * 100).toFixed(1)}%`
                  : ""}
              </span>
            </div>
          </article>
        );
      })}

    </div>
  );
}
