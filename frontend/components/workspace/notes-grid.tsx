"use client";

import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { useLayoutEffect, useRef, useState } from "react";
import { GripVertical, Plus } from "lucide-react";
import type { Note, NoteReorder } from "@/types/workspace";

type NotesGridProps = {
  notes: Note[];
  semanticResults: Note[] | null;
  isLoading: boolean;
  selectedId: string;
  canEditBoard: boolean;
  isCreating: boolean;
  onSelectNote: (noteId: string) => void;
  onCreateNote: () => void | Promise<void>;
  onReorderNote: (reorder: NoteReorder) => void;
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
  onReorderNote,
}: NotesGridProps) {
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [settlingNoteId, setSettlingNoteId] = useState<string | null>(null);
  const [isPointerActive, setIsPointerActive] = useState(false);
  const pendingPointerRef = useRef<{ noteId: string; x: number; y: number } | null>(null);
  const initialDropIndexRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const layoutSnapshotRef = useRef(new Map<string, DOMRect>());
  const settleTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || layoutSnapshotRef.current.size === 0) {
      return;
    }

    const movedCards: Array<{ element: HTMLElement; x: number; y: number }> = [];
    grid.querySelectorAll<HTMLElement>("[data-note-id]").forEach((element) => {
      const previousRect = layoutSnapshotRef.current.get(element.dataset.noteId || "");
      if (!previousRect) {
        return;
      }

      const nextRect = element.getBoundingClientRect();
      if (previousRect.left !== nextRect.left || previousRect.top !== nextRect.top) {
        movedCards.push({
          element,
          x: previousRect.left - nextRect.left,
          y: previousRect.top - nextRect.top,
        });
      }
    });
    layoutSnapshotRef.current.clear();

    if (movedCards.length === 0) {
      return;
    }

    movedCards.forEach(({ element, x, y }) => {
      element.style.transition = "none";
      element.style.transform = `translate(${x}px, ${y}px)`;
    });

    const frame = window.requestAnimationFrame(() => {
      movedCards.forEach(({ element }) => {
        element.style.transition = "";
        element.style.transform = "";
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [dropIndex]);

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>, noteId: string) => {
    if (!canEditBoard || event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClickRef.current = false;
    setIsPointerActive(true);
    pendingPointerRef.current = { noteId, x: event.clientX, y: event.clientY };
    initialDropIndexRef.current = notes.findIndex((note) => note.id === noteId);
  };

  const resetDragState = () => {
    pendingPointerRef.current = null;
    initialDropIndexRef.current = null;
    setIsPointerActive(false);
    setDraggedNoteId(null);
    setDropIndex(null);
  };

  const handleDrop = (noteId: string | null, clientX: number, clientY: number) => {
    if (!noteId) {
      resetDragState();
      return;
    }

    const grid = gridRef.current;
    if (
      !grid ||
      clientX < grid.getBoundingClientRect().left ||
      clientX > grid.getBoundingClientRect().right ||
      clientY < grid.getBoundingClientRect().top ||
      clientY > grid.getBoundingClientRect().bottom
    ) {
      resetDragState();
      return;
    }

    const remainingNotes = notes.filter((note) => note.id !== noteId);
    const insertionIndex = Math.max(0, Math.min(dropIndex ?? remainingNotes.length, remainingNotes.length));
    const targetNote = remainingNotes[insertionIndex] || remainingNotes[insertionIndex - 1];

    if (noteId && targetNote && noteId !== targetNote.id) {
      const nextNotes = [...remainingNotes];
      const targetIndex = remainingNotes.findIndex((note) => note.id === targetNote.id);
      const nextIndex = insertionIndex < remainingNotes.length ? targetIndex : targetIndex + 1;
      const movedNote = notes.find((note) => note.id === noteId);
      if (!movedNote) {
        resetDragState();
        return;
      }

      nextNotes.splice(nextIndex, 0, movedNote);
      const hasChangedOrder = nextNotes.some((note, index) => note.id !== notes[index]?.id);

      if (!hasChangedOrder) {
        resetDragState();
        return;
      }

      onReorderNote({
        noteId,
        targetNoteId: targetNote.id,
        position: insertionIndex < remainingNotes.length ? "before" : "after",
      });
      setSettlingNoteId(noteId);
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = window.setTimeout(() => setSettlingNoteId(null), 360);
    }

    resetDragState();
  };

  return (
    <div
      ref={gridRef}
      className={[
        "grid grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))] gap-4",
        isPointerActive && "select-none",
      ].filter(Boolean).join(" ")}
      data-testid="notes-grid"
      onPointerMove={(event) => {
        const pendingPointer = pendingPointerRef.current;
        let activeDraggedNoteId = draggedNoteId;

        if (!activeDraggedNoteId && pendingPointer) {
          const distance = Math.hypot(
            event.clientX - pendingPointer.x,
            event.clientY - pendingPointer.y
          );

          if (distance < 6) {
            return;
          }

          activeDraggedNoteId = pendingPointer.noteId;
          suppressClickRef.current = true;
          setDraggedNoteId(activeDraggedNoteId);
          setDropIndex(notes.findIndex((note) => note.id === activeDraggedNoteId));
        }

        if (!activeDraggedNoteId) {
          return;
        }

        const cardElements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-note-id]"))
          .filter((card) => card.dataset.noteId !== activeDraggedNoteId);
        const cards = cardElements.map((card) => card.getBoundingClientRect());

        if (cards.length === 0) {
          setDropIndex(0);
          return;
        }

        const nearestCard = cards.reduce(
          (nearest, rect, index) => {
            const distance = Math.hypot(
              event.clientX - (rect.left + rect.width / 2),
              event.clientY - (rect.top + rect.height / 2)
            );
            return distance < nearest.distance ? { distance, index, rect } : nearest;
          },
          { distance: Number.POSITIVE_INFINITY, index: 0, rect: cards[0] }
        );
        const isAfterNearest =
          event.clientY > nearestCard.rect.top + nearestCard.rect.height / 2 ||
          (event.clientY >= nearestCard.rect.top &&
            event.clientY <= nearestCard.rect.bottom &&
            event.clientX > nearestCard.rect.left + nearestCard.rect.width / 2);

        const nextDropIndex = nearestCard.index + (isAfterNearest ? 1 : 0);
        if (nextDropIndex === dropIndex) {
          return;
        }

        layoutSnapshotRef.current = new Map(
          cards.map((rect, index) => {
            const card = cardElements[index];
            return [card?.dataset.noteId || "", rect];
          })
        );
        setDropIndex(nextDropIndex);
      }}
      onPointerUp={(event) => {
        if (draggedNoteId) {
          handleDrop(draggedNoteId, event.clientX, event.clientY);
          return;
        }

        pendingPointerRef.current = null;
        setIsPointerActive(false);
      }}
      onPointerCancel={resetDragState}
    >
      {!isLoading && canEditBoard && (
        <Button variant="unstyled"
          type="button"
          data-testid="create-note"
          className="grid aspect-square min-h-45 place-items-center border border-dashed border-overlay/10 bg-transparent text-muted-foreground hover:border-subtle"
          onClick={() => void onCreateNote()}
          disabled={isCreating}
        >
          <div className="text-center">
            <Plus size={24} className="mx-auto mb-2" aria-hidden="true" />
            <p className="text-label uppercase tracking-label-lg">{isCreating ? "Creating..." : "Create New Note"}</p>
          </div>
        </Button>
      )}

      {isLoading && <p className="text-xs uppercase tracking-label-lg text-muted-foreground">Loading notes...</p>}

      {!isLoading && notes.map((note, noteIndex) => {
        const preview = (note.content || "No content yet").replace(/\s+/g, " ").trim().slice(0, 160);
        const isIndexed = !note.embeddingPending;
        const isDragged = draggedNoteId === note.id;
        const notesBefore = notes.slice(0, noteIndex);
        const nonDraggedNotesBefore = notesBefore.filter((item) => item.id !== draggedNoteId).length;
        const isDropGap =
          draggedNoteId &&
          note.id !== draggedNoteId &&
          dropIndex !== initialDropIndexRef.current &&
          dropIndex === nonDraggedNotesBefore;

        return (
          <div key={note.id} className="contents">
            {isDropGap && (
              <div
                aria-hidden="true"
                className="min-h-45 rounded-sm border border-dashed border-overlay/28 bg-transparent transition-all duration-200"
              />
            )}
            <article
              data-testid="note-card"
              data-note-id={note.id}
              className={[
                "flex aspect-square min-h-45 min-w-0 cursor-pointer flex-col overflow-hidden border p-4.25 transition-[transform,opacity,box-shadow,border-color] duration-200 ease-out",
                note.id === selectedId
                  ? "border-subtle bg-card-translucent/40 shadow-card-inset"
                  : "border-overlay/10 bg-card-translucent/40 hover:border-subtle",
                isDragged &&
                  "pointer-events-none z-10 scale-[1.02] -translate-y-1 border-foreground shadow-card-lift",
                settlingNoteId === note.id && "note-card-settle",
              ].filter(Boolean).join(" ")}
            onPointerDown={(event) => handlePointerDown(event, note.id)}
            onClick={(event) => {
              if (suppressClickRef.current) {
                event.preventDefault();
                suppressClickRef.current = false;
                return;
              }

              onSelectNote(note.id);
            }}
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
              <Heading level={3} className="min-w-0 truncate text-xs uppercase tracking-caps text-foreground">
                {note.title || "Untitled"}
              </Heading>
              <div className="flex shrink-0 items-center gap-2">
                {canEditBoard && (
                  <GripVertical
                    size={14}
                    className="cursor-grab text-subtle active:cursor-grabbing"
                    aria-label="Drag to reorder note"
                  />
                )}
                <span
                  className={isIndexed ? "mt-0.5 h-3 w-3 bg-success-strong" : "mt-0.5 h-3 w-3 bg-danger"}
                  aria-label={isIndexed ? "Indexed note" : "Note indexing pending"}
                />
              </div>
            </div>

            <p className="mt-3 line-clamp-4 text-xs leading-title text-muted-foreground">
              {preview}
              {(note.content || "").length > 160 ? "..." : ""}
            </p>
            <div className="mt-auto flex items-center justify-between border-t border-overlay/10 pt-3.25 text-micro uppercase tracking-label-sm text-muted-foreground">
              <span>{note.embeddingPending ? "Index pending" : "Updated recently"}</span>
              <span>
                {semanticResults && note.semanticScore !== null && note.semanticScore !== undefined
                  ? `${(note.semanticScore * 100).toFixed(1)}%`
                  : ""}
              </span>
            </div>
            </article>
          </div>
        );
      })}

      {draggedNoteId &&
        dropIndex !== initialDropIndexRef.current &&
        dropIndex === notes.filter((note) => note.id !== draggedNoteId).length && (
        <div
          aria-hidden="true"
          className="min-h-45 rounded-sm border border-dashed border-overlay/28 bg-transparent transition-all duration-200"
        />
      )}
    </div>
  );
}
