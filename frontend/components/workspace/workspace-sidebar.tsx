"use client";

import { Button } from "@/components/ui/button";
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
  onResetSearch: _onResetSearch,
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
        <Button variant="unstyled"
          type="button"
          className="fixed inset-x-0 bottom-0 top-menu-offset z-30 bg-shade/70 md:hidden"
          onClick={onClose}
          aria-label="Close workspace navigation"
        />
      )}

      <aside
        id="workspace-sidebar"
        className={
          isSidebarOpen
            ? "fixed inset-x-auto bottom-0 left-0 top-menu-offset z-40 flex w-[88vw] max-w-popover flex-col border-r border-overlay/10 bg-background shadow-2xl md:static md:z-auto md:w-sidebar md:shrink-0 md:shadow-none"
            : "flex max-md:hidden w-sidebar shrink-0 flex-col border-r border-overlay/10 bg-background"
        }
      >
        <nav className="flex-1 overflow-y-auto px-4 py-4">
          <p className="pb-3 text-label uppercase tracking-label-lg text-muted-foreground">Boards</p>

          <Button variant="unstyled"
            type="button"
            className="flex h-9 w-full items-center justify-center gap-2 border border-dashed border-overlay/10 px-inset py-inset-sm text-label uppercase tracking-label-lg text-muted-foreground hover:border-subtle"
            onClick={() => void onCreateBoard()}
            disabled={isCreatingBoard}
          >
            <Plus size={14} aria-hidden="true" /> {isCreatingBoard ? "Creating..." : "New Board"}
          </Button>

          <div className="mt-2 space-y-2">
            {boards.map((board) => (
              <div
                key={board.id}
                className={
                  board.id === activeBoardId
                    ? "flex h-9 items-center border border-subtle bg-secondary"
                    : "flex h-9 items-center border border-overlay/10"
                }
              >
                <Button variant="unstyled"
                  type="button"
                  className="flex min-w-0 flex-1 items-center px-inset py-inset-sm text-left text-xs uppercase tracking-caps text-foreground"
                  onClick={() => {
                    onSelectBoard(board);
                    onClose();
                  }}
                >
                  <span className="truncate">{board.name}</span>
                </Button>
                {board.ownerId === sessionId && (
                  <div className="relative mr-1 flex shrink-0 items-center gap-1">
                    <Button variant="unstyled"
                      type="button"
                      className="grid h-6 w-6 place-items-center text-muted-foreground hover:text-foreground"
                      onClick={() => setOpenBoardMenuId((currentId) => (currentId === board.id ? null : board.id))}
                      aria-label={`Board options for ${board.name}`}
                      aria-expanded={openBoardMenuId === board.id}
                      aria-haspopup="menu"
                      title={`Board options for ${board.name}`}
                    >
                      <MoreHorizontal size={14} aria-hidden="true" />
                    </Button>

                    {openBoardMenuId === board.id && (
                      <div
                        className="absolute right-0 top-8 z-50 w-sidebar-sm max-w-[calc(100vw-3rem)] border border-overlay/15 bg-card p-2 shadow-2xl"
                        role="menu"
                        aria-label={`${board.name} options`}
                      >
                        <div className="flex items-center gap-2 border-b border-overlay/10 px-2 pb-2 text-micro uppercase tracking-label text-foreground">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${board.shareLinkActive ? "bg-success" : "bg-danger"}`}
                            aria-hidden="true"
                          />
                          <span className="truncate">{board.shareLinkActive ? "Link sharing active" : "No active link"}</span>
                        </div>

                        <Button variant="unstyled"
                          type="button"
                          className={`flex w-full items-center gap-2 px-2 py-2 text-left text-micro uppercase tracking-label ${canManageSharing ? "text-muted-foreground hover:bg-secondary hover:text-foreground" : "text-subtle"}`}
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
                        </Button>
                        <Button variant="unstyled"
                          type="button"
                          className={`flex w-full items-center gap-2 px-2 py-2 text-left text-micro uppercase tracking-label ${canManageSharing ? "text-muted-foreground hover:bg-secondary hover:text-foreground" : "text-subtle"}`}
                          onClick={() => openShareDialog(board)}
                          role="menuitem"
                        >
                          <Link2 size={14} aria-hidden="true" />
                          <span>{board.shareLinkActive ? "Generate new link" : "Generate link"}</span>
                        </Button>
                        {board.shareLinkActive && (
                          <Button variant="unstyled"
                            type="button"
                            className="flex w-full items-center gap-2 px-2 py-2 text-left text-micro uppercase tracking-label text-muted-foreground hover:bg-secondary hover:text-danger-foreground"
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
                          </Button>
                        )}
                        {board.shareToken && (
                          <div className="mt-1 border-t border-overlay/10 pt-2">
                            <Button variant="unstyled"
                              type="button"
                              className="inline-flex items-center gap-1.5 border border-overlay/10 px-2 py-1.5 text-micro uppercase tracking-label text-muted-foreground hover:border-subtle hover:text-foreground"
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
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    <Button variant="unstyled"
                      type="button"
                      className="grid h-6 w-6 shrink-0 place-items-center text-muted-foreground hover:text-danger"
                      onClick={() => void onDeleteBoard(board)}
                      disabled={deletingBoardId === board.id}
                      aria-label={`Delete board ${board.name}`}
                      title={`Delete board ${board.name}`}
                    >
                      {deletingBoardId === board.id ? "..." : <Trash2 size={14} aria-hidden="true" />}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </nav>

        <div className="border-t border-overlay/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center border border-overlay/10 bg-secondary text-micro tracking-label-lg text-foreground">
              {sessionMode === "user" ? "88" : "G"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-label uppercase tracking-label-lg text-muted-foreground">
                {sessionMode === "user" ? currentUserEmail?.split("@")[0] || "User" : "Guest"}
              </p>
              <Badge
                variant={sessionMode === "guest" ? "warning" : "outline"}
                className="mt-1 rounded-none px-1.5 py-0 font-mono text-nano uppercase tracking-label"
              >
                {sessionMode === "guest" ? "Demo mode" : "Account mode"}
              </Badge>
            </div>
          </div>
          {sessionMode === "guest" && (
            <>
              <p className="pt-2 font-mono text-micro uppercase tracking-label text-subtle">
                Temporary workspace
              </p>
              <Button variant="unstyled"
                type="button"
                className="mt-3 flex w-full items-center justify-center gap-2 border border-danger/30 px-2 py-2 text-micro uppercase tracking-label text-danger-foreground hover:border-danger hover:text-danger-hover"
                onClick={() => void onDeleteDemoWorkspace()}
                disabled={isDeletingDemoWorkspace}
                aria-label="Delete demo workspace"
                title="Delete demo workspace"
              >
                <Trash2 size={13} aria-hidden="true" />
                <span>{isDeletingDemoWorkspace ? "Deleting demo..." : "Delete demo workspace"}</span>
              </Button>
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
