"use client";

import { FileText, Folder, Plus, Search } from "lucide-react";
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
          className="fixed inset-x-0 bottom-0 top-[51px] z-30 bg-black/70 lg:hidden"
          onClick={onClose}
          aria-label="Close workspace navigation"
        />
      )}

      <aside
        id="workspace-sidebar"
        className={
          isSidebarOpen
            ? "fixed inset-x-auto bottom-0 left-0 top-[51px] z-40 flex w-[88vw] max-w-[400px] flex-col border-r border-[#444748] bg-[#0e0e0e] shadow-2xl lg:static lg:z-auto lg:w-[400px] lg:shrink-0 lg:shadow-none"
            : "hidden flex-col border-r border-[#444748] bg-[#0e0e0e] lg:flex lg:w-[400px] lg:shrink-0"
        }
      >
        <div className="h-[68px] border-b border-[#2f3131] p-4">
          <button
            type="button"
            className="flex h-9 w-full items-center justify-between border border-[#444748] px-2 text-sm text-[#c4c7c8]"
            onClick={onResetSearch}
          >
            <span className="flex items-center gap-2">
              <Search size={16} /> Search...
            </span>
            <span className="border border-[#444748] px-1 text-xs">⌘K</span>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <p className="px-2 pb-2 text-xs tracking-[0.2em] text-[#8e9192]">WORKSPACES</p>
          <div className="space-y-1">
            {boards.map((board, index) => (
              <div key={board.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className={
                    board.id === activeBoardId
                      ? "flex h-10 flex-1 items-center gap-2 border border-[#444748] bg-black px-2 text-left text-sm text-white"
                      : "flex h-10 flex-1 items-center gap-2 px-2 text-left text-sm text-[#c4c7c8] hover:border hover:border-[#2f3131]"
                  }
                  onClick={() => {
                    onSelectBoard(board);
                    onClose();
                  }}
                >
                  {index % 2 === 0 ? <Folder size={16} /> : <FileText size={16} />}
                  <span className="truncate">{board.name}</span>
                </button>
                {board.ownerId === sessionId && (
                  <button
                    type="button"
                    className="grid h-10 w-9 place-items-center border border-[#444748] text-[#efb3af] hover:bg-[#2a181a]"
                    onClick={() => void onDeleteBoard(board)}
                    disabled={deletingBoardId === board.id}
                    aria-label={`Delete board ${board.name}`}
                    title={`Delete board ${board.name}`}
                  >
                    {deletingBoardId === board.id ? "..." : "×"}
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mt-2 flex h-[42px] w-full items-center gap-2 border border-dashed border-[#444748] px-2 text-sm text-[#8e9192]"
            onClick={() => void onCreateBoard()}
            disabled={isCreatingBoard}
          >
            <Plus size={14} /> {isCreatingBoard ? "Creating..." : "New Board"}
          </button>
        </nav>

        <div className="border-t border-[#444748] p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center bg-[#1f2020] text-xs text-[#c4c7c8]">GS</span>
            <div>
              <p className="text-sm text-white">{sessionMode === "user" ? "User Session" : "Guest Session"}</p>
              <p className="text-xs text-[#8e9192]">{currentUserEmail || sessionId.slice(0, 12)}</p>
            </div>
          </div>
          <p className="text-xs text-[#8e9192]">Workspace controls available in top bar.</p>
        </div>
      </aside>
    </>
  );
}
