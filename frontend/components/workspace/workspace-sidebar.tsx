"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Board, SessionMode } from "@/types/workspace";

type WorkspaceSidebarProps = {
  boards: Board[];
  activeBoardId: string;
  sessionId: string;
  sessionMode: SessionMode;
  currentUserEmail: string | null;
  isSidebarOpen: boolean;
  isCreatingBoard: boolean;
  deletingBoardId: string | null;
  onClose: () => void;
  onResetSearch: () => void;
  onSelectBoard: (board: Board) => void;
  onDeleteBoard: (board: Board) => void | Promise<void>;
  onCreateBoard: () => void | Promise<void>;
};

export function WorkspaceSidebar({
  boards,
  activeBoardId,
  sessionId,
  sessionMode,
  currentUserEmail,
  isSidebarOpen,
  isCreatingBoard,
  deletingBoardId,
  onClose,
  onResetSearch,
  onSelectBoard,
  onDeleteBoard,
  onCreateBoard,
}: WorkspaceSidebarProps) {
  return (
    <>
      {isSidebarOpen && (
        <button
          type="button"
          className="fixed inset-x-0 bottom-0 top-[130px] z-30 bg-black/70 lg:hidden"
          onClick={onClose}
          aria-label="Close workspace navigation"
        />
      )}

      <aside
        id="workspace-sidebar"
        className={
          isSidebarOpen
            ? "fixed inset-x-auto bottom-0 left-0 top-[130px] z-40 flex w-[88vw] max-w-[320px] flex-col border-r border-[rgba(255,255,255,0.1)] bg-[#0a0a0a] shadow-2xl lg:static lg:z-auto lg:w-[256px] lg:shrink-0 lg:shadow-none"
            : "hidden flex-col border-r border-[rgba(255,255,255,0.1)] bg-[#0a0a0a] lg:flex lg:w-[256px] lg:shrink-0"
        }
      >
        <nav className="flex-1 overflow-y-auto px-4 py-4">
          <p className="pb-3 text-[11px] uppercase tracking-[0.55px] text-[#a1a1a1]">Boards</p>

          <button
            type="button"
            className="flex h-9 w-full items-center justify-center gap-2 border border-dashed border-[rgba(255,255,255,0.1)] px-[13px] py-[9px] text-[11px] uppercase tracking-[0.55px] text-[#a1a1a1] hover:border-[#737373]"
            onClick={() => void onCreateBoard()}
            disabled={isCreatingBoard}
          >
            <Plus size={14} aria-hidden="true" /> {isCreatingBoard ? "Creating..." : "New Board"}
          </button>

          <div className="mt-2 space-y-2">
            {boards.map((board, index) => (
              <div
                key={board.id}
                className={
                  board.id === activeBoardId
                    ? "flex h-9 items-center border border-[#737373] bg-[#262626]"
                    : "flex h-9 items-center border border-[rgba(255,255,255,0.1)]"
                }
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center px-[13px] py-[9px] text-left text-xs uppercase tracking-[0.6px] text-[#fafafa]"
                  onClick={() => {
                    onSelectBoard(board);
                    onClose();
                  }}
                >
                  <span className="truncate">{board.name}</span>
                </button>
                {board.ownerId === sessionId && (
                  <button
                    type="button"
                    className="mr-1 grid h-6 w-6 shrink-0 place-items-center text-[#a1a1a1] hover:text-[#f52f39]"
                    onClick={() => void onDeleteBoard(board)}
                    disabled={deletingBoardId === board.id}
                    aria-label={`Delete board ${board.name}`}
                    title={`Delete board ${board.name}`}
                  >
                    {deletingBoardId === board.id ? "..." : <Trash2 size={14} aria-hidden="true" />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </nav>

        <div className="border-t border-[rgba(255,255,255,0.1)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center border border-[rgba(255,255,255,0.1)] bg-[#262626] text-[10px] tracking-[0.55px] text-[#fafafa]">
              {sessionMode === "user" ? "88" : "G"}
            </span>
            <p className="truncate text-[11px] uppercase tracking-[0.55px] text-[#a1a1a1]">
              {sessionMode === "user" ? currentUserEmail?.split("@")[0] || "User" : "Guest"}
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
