"use client";

import { FileText, Plus, Sparkles } from "lucide-react";
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {isLoading && <p className="text-[#9aa7bf]">Loading notes...</p>}

      {!isLoading && notes.map((note) => {
        const preview = (note.content || "No content yet").replace(/\s+/g, " ").trim().slice(0, 160);

        return (
          <article
            key={note.id}
            className={
              note.id === selectedId
                ? "flex h-[220px] cursor-pointer flex-col border border-[#444748] bg-[#0e0e0e] p-3 shadow-[inset_0_0_0_1px_#ffffff10] sm:h-[249px] sm:p-4"
                : "flex h-[220px] cursor-pointer flex-col border border-[#2f3131] bg-[#0e0e0e] p-3 sm:h-[249px] sm:p-4"
            }
            onClick={() => onSelectNote(note.id)}
          >
            <div className="flex items-center justify-between">
              <span className="bg-[#353535] px-2 py-1 text-sm text-[#c4c7c8]">
                {note.embeddingPending ? "draft" : "active"}
              </span>
              {note.embeddingPending ? (
                <Sparkles size={16} className="text-[#ffd27c]" />
              ) : (
                <FileText size={16} className="text-[#8e9192]" />
              )}
            </div>
            <h3 className="mb-2 mt-3 line-clamp-2 break-words text-sm text-white sm:mt-4 sm:text-base">
              {note.title || "Untitled"}
            </h3>
            <p className="line-clamp-3 text-sm leading-5 text-[#c4c7c8] sm:text-base sm:leading-6">
              {preview}
              {(note.content || "").length > 160 ? "..." : ""}
            </p>
            <div className="mt-auto flex items-center justify-between border-t border-[#444748] pt-3 text-sm text-[#8e9192]">
              <span>{note.embeddingPending ? "Index pending" : "Indexed"}</span>
              <span>
                {semanticResults && note.semanticScore !== null && note.semanticScore !== undefined
                  ? `${(note.semanticScore * 100).toFixed(1)}%`
                  : "Live"}
              </span>
            </div>
          </article>
        );
      })}

      {!isLoading && canEditBoard && (
        <button
          type="button"
          className="grid h-[220px] place-items-center border border-[#2f3131] bg-transparent text-[#8e9192] hover:border-[#444748] sm:h-[249px]"
          onClick={() => void onCreateNote()}
        >
          <div className="text-center">
            <Plus size={18} className="mx-auto mb-2" />
            <p className="text-base tracking-[0.02em]">{isCreating ? "Creating..." : "Create New Note"}</p>
          </div>
        </button>
      )}
    </div>
  );
}
