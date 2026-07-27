"use client";

import { useState } from "react";
import { Copy, Link2, Link2Off, MoreHorizontal, Plus, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SharePermissionDialog } from "@/components/workspace/share-permission-dialog";
import type { Board, BoardPermission, SessionMode } from "@/types/workspace";

type WorkspaceSidebarProps = {
  boards: Board[];
  activeBoardId: string;
  sessionId: string;
  sessionMode: SessionMode;
  canManageSharing: boolean;
  currentUserEmail: string | null;
  isSidebarOpen: boolean;
  isCreatingBoard: boolean;
  deletingBoardId: string | null;
  isDeletingDemoWorkspace: boolean;
  onClose: () => void;
  onResetSearch: () => void;
  onSelectBoard: (board: Board) => void;
  onDeleteBoard: (board: Board) => void | Promise<void>;
  onShareBoard: (board: Board, permission: BoardPermission) => void | Promise<void>;
  onCopyShareLink: (board: Board) => void | Promise<void>;
  onRevokeShareLink: (board: Board) => void | Promise<void>;
  onShowBoardAccess: (board: Board) => void;
  onVerificationRequired: () => void;
  onCreateBoard: () => void | Promise<void>;
  onDeleteDemoWorkspace: () => void | Promise<void>;
};

export function WorkspaceSidebar({
  boards,
  activeBoardId,
  sessionId,
  sessionMode,
  canManageSharing,
  currentUserEmail,
  isSidebarOpen,
  isCreatingBoard,
  deletingBoardId,
  isDeletingDemoWorkspace,
  onClose,
  onResetSearch,
  onSelectBoard,
  onDeleteBoard,
  onShareBoard,
  onCopyShareLink,
  onRevokeShareLink,
  onShowBoardAccess,
  onVerificationRequired,
  onCreateBoard,
  onDeleteDemoWorkspace,
}: WorkspaceSidebarProps) {
  const [openBoardMenuId, setOpenBoardMenuId] = useState<string | null>(null);
  const [shareTargetBoard, setShareTargetBoard] = useState<Board | null>(null);
  const [sharePermission, setSharePermission] = useState<BoardPermission>("view");
  const [isGeneratingShareLink, setIsGeneratingShareLink] = useState(false);

  const openShareDialog = (board: Board) => {
    setOpenBoardMenuId(null);

    if (!canManageSharing) {
      onVerificationRequired();
      return;
    }

    setShareTargetBoard(board);
    setSharePermission(board.shareLinkActive ? board.sharePermission : "view");
  };

  const confirmShare = async () => {
    if (!shareTargetBoard) {
      return;
    }

    setIsGeneratingShareLink(true);

    try {
      await onShareBoard(shareTargetBoard, sharePermission);
      setShareTargetBoard(null);
    } finally {
      setIsGeneratingShareLink(false);
    }
  };

  return (
    <>
      {isSidebarOpen && (
        <button
          type="button"
          className="fixed inset-x-0 bottom-0 top-[130px] z-30 bg-black/70 md:hidden"
          onClick={onClose}
          aria-label="Close workspace navigation"
        />
      )}

      <aside
        id="workspace-sidebar"
        className={
          isSidebarOpen
            ? "fixed inset-x-auto bottom-0 left-0 top-[130px] z-40 flex w-[88vw] max-w-[320px] flex-col border-r border-[rgba(255,255,255,0.1)] bg-[#0a0a0a] shadow-2xl md:static md:z-auto md:w-[256px] md:shrink-0 md:shadow-none"
            : "flex max-md:hidden w-[256px] shrink-0 flex-col border-r border-[rgba(255,255,255,0.1)] bg-[#0a0a0a]"
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
            {boards.map((board) => (
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
                  <div className="relative mr-1 flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="grid h-6 w-6 place-items-center text-[#a1a1a1] hover:text-[#fafafa]"
                      onClick={() => setOpenBoardMenuId((currentId) => (currentId === board.id ? null : board.id))}
                      aria-label={`Board options for ${board.name}`}
                      aria-expanded={openBoardMenuId === board.id}
                      aria-haspopup="menu"
                      title={`Board options for ${board.name}`}
                    >
                      <MoreHorizontal size={14} aria-hidden="true" />
                    </button>

                    {openBoardMenuId === board.id && (
                      <div
                        className="absolute right-0 top-8 z-50 w-[240px] max-w-[calc(100vw-48px)] border border-[rgba(255,255,255,0.15)] bg-[#171717] p-2 shadow-2xl"
                        role="menu"
                        aria-label={`${board.name} options`}
                      >
                        <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.1)] px-2 pb-2 text-[10px] uppercase tracking-[0.45px] text-[#fafafa]">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${board.shareLinkActive ? "bg-[#33d17a]" : "bg-[#f52f39]"}`}
                            aria-hidden="true"
                          />
                          <span className="truncate">{board.shareLinkActive ? "Link sharing active" : "No active link"}</span>
                        </div>

                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 px-2 py-2 text-left text-[10px] uppercase tracking-[0.45px] ${canManageSharing ? "text-[#a1a1a1] hover:bg-[#262626] hover:text-[#fafafa]" : "text-[#737373]"}`}
                          onClick={() => {
                            setOpenBoardMenuId(null);
                            if (canManageSharing) {
                              onShowBoardAccess(board);
                            } else {
                              onVerificationRequired();
                            }
                            onClose();
                          }}
                          role="menuitem"
                        >
                          <Users size={14} aria-hidden="true" />
                          <span>People and access</span>
                        </button>
                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 px-2 py-2 text-left text-[10px] uppercase tracking-[0.45px] ${canManageSharing ? "text-[#a1a1a1] hover:bg-[#262626] hover:text-[#fafafa]" : "text-[#737373]"}`}
                          onClick={() => openShareDialog(board)}
                          role="menuitem"
                        >
                          <Link2 size={14} aria-hidden="true" />
                          <span>{board.shareLinkActive ? "Generate new link" : "Generate link"}</span>
                        </button>
                        {board.shareLinkActive && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-2 py-2 text-left text-[10px] uppercase tracking-[0.45px] text-[#a1a1a1] hover:bg-[#262626] hover:text-[#fca5a5]"
                            onClick={() => {
                              setOpenBoardMenuId(null);
                              if (canManageSharing) {
                                void onRevokeShareLink(board);
                              } else {
                                onVerificationRequired();
                              }
                            }}
                            role="menuitem"
                          >
                            <Link2Off size={14} aria-hidden="true" />
                            <span>Revoke link</span>
                          </button>
                        )}
                        {board.shareToken && (
                          <div className="mt-1 border-t border-[rgba(255,255,255,0.1)] pt-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 border border-[rgba(255,255,255,0.1)] px-2 py-1.5 text-[10px] uppercase tracking-[0.45px] text-[#a1a1a1] hover:border-[#737373] hover:text-[#fafafa]"
                              onClick={() => {
                                setOpenBoardMenuId(null);
                                if (canManageSharing) {
                                  void onCopyShareLink(board);
                                } else {
                                  onVerificationRequired();
                                }
                              }}
                              role="menuitem"
                              aria-label="Copy share link"
                            >
                              <Copy size={13} aria-hidden="true" />
                              <span>Copy link</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      className="grid h-6 w-6 shrink-0 place-items-center text-[#a1a1a1] hover:text-[#f52f39]"
                      onClick={() => void onDeleteBoard(board)}
                      disabled={deletingBoardId === board.id}
                      aria-label={`Delete board ${board.name}`}
                      title={`Delete board ${board.name}`}
                    >
                      {deletingBoardId === board.id ? "..." : <Trash2 size={14} aria-hidden="true" />}
                    </button>
                  </div>
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
            <div className="min-w-0">
              <p className="truncate text-[11px] uppercase tracking-[0.55px] text-[#a1a1a1]">
                {sessionMode === "user" ? currentUserEmail?.split("@")[0] || "User" : "Guest"}
              </p>
              <Badge
                variant={sessionMode === "guest" ? "warning" : "outline"}
                className="mt-1 rounded-none px-1.5 py-0 font-mono text-[9px] uppercase tracking-[0.45px]"
              >
                {sessionMode === "guest" ? "Demo mode" : "Account mode"}
              </Badge>
            </div>
          </div>
          {sessionMode === "guest" && (
            <>
              <p className="pt-2 font-mono text-[10px] uppercase tracking-[0.45px] text-[#737373]">
                Temporary workspace
              </p>
              <button
                type="button"
                className="mt-3 flex w-full items-center justify-center gap-2 border border-[#f52f39]/30 px-2 py-2 text-[10px] uppercase tracking-[0.45px] text-[#fca5a5] hover:border-[#f52f39] hover:text-[#fecaca]"
                onClick={() => void onDeleteDemoWorkspace()}
                disabled={isDeletingDemoWorkspace}
                aria-label="Delete demo workspace"
                title="Delete demo workspace"
              >
                <Trash2 size={13} aria-hidden="true" />
                <span>{isDeletingDemoWorkspace ? "Deleting demo..." : "Delete demo workspace"}</span>
              </button>
            </>
          )}
        </div>
      </aside>

      {shareTargetBoard && (
        <SharePermissionDialog
          board={shareTargetBoard}
          permission={sharePermission}
          isSubmitting={isGeneratingShareLink}
          onPermissionChange={setSharePermission}
          onCancel={() => setShareTargetBoard(null)}
          onConfirm={confirmShare}
        />
      )}
    </>
  );
}
