"use client";

import { Link2, Trash2, UserRound, X } from "lucide-react";
import type { Board, BoardCollaborator, BoardPermission } from "@/types/workspace";

type BoardAccessPanelProps = {
  board: Board;
  currentUserEmail: string | null;
  collaborators: BoardCollaborator[];
  isLoading: boolean;
  collaboratorActionEmail: string | null;
  onClose: () => void;
  onUpdatePermission: (email: string, permission: BoardPermission) => void | Promise<void>;
  onRemoveCollaborator: (email: string) => void | Promise<void>;
};

function permissionLabel(permission: BoardPermission): string {
  return permission === "edit" ? "Write" : "Read";
}

function permissionBadgeClass(permission: BoardPermission): string {
  return permission === "edit"
    ? "border-[rgba(51,209,122,0.4)] text-[#7ee2a8]"
    : "border-[rgba(255,255,255,0.15)] text-[#a1a1a1]";
}

export function BoardAccessPanel({
  board,
  currentUserEmail,
  collaborators,
  isLoading,
  collaboratorActionEmail,
  onClose,
  onUpdatePermission,
  onRemoveCollaborator,
}: BoardAccessPanelProps) {
  return (
    <section className="mb-5 border border-[rgba(255,255,255,0.1)] bg-[rgba(23,23,23,0.55)]" aria-labelledby="board-access-title">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.55px] text-[#a1a1a1]">Board access</p>
          <h2 id="board-access-title" className="mt-1 truncate text-sm text-[#fafafa]">
            People and permissions
          </h2>
          <p className="mt-1 truncate text-[11px] text-[#a1a1a1]">{board.name}</p>
        </div>
        <button
          type="button"
          className="grid h-7 w-7 shrink-0 place-items-center text-[#a1a1a1] hover:text-[#fafafa]"
          onClick={onClose}
          aria-label="Close board access"
          title="Close board access"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="border-t border-[rgba(255,255,255,0.1)]">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center border border-[rgba(255,255,255,0.1)] text-[#a1a1a1]">
            <UserRound size={14} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-[#fafafa]">{currentUserEmail || "You"}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.45px] text-[#a1a1a1]">Board owner</p>
          </div>
          <span className={`border px-2 py-1 text-[10px] uppercase tracking-[0.45px] ${permissionBadgeClass("edit")}`}>
            Write
          </span>
        </div>

        {board.shareToken && (
          <div className="flex items-center gap-3 border-t border-[rgba(255,255,255,0.1)] px-4 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center border border-[rgba(51,209,122,0.35)] text-[#7ee2a8]">
              <Link2 size={14} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-[#fafafa]">Anyone with the active link</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.45px] text-[#a1a1a1]">
                {permissionLabel(board.sharePermission)} access
              </p>
            </div>
            <span
              className={`border px-2 py-1 text-[10px] uppercase tracking-[0.45px] ${permissionBadgeClass(board.sharePermission)}`}
            >
              {permissionLabel(board.sharePermission)}
            </span>
          </div>
        )}

        <div className="border-t border-[rgba(255,255,255,0.1)]">
          {isLoading ? (
            <p className="px-4 py-4 text-[11px] text-[#a1a1a1]">Loading people with access...</p>
          ) : collaborators.length === 0 ? (
            <p className="px-4 py-4 text-[11px] text-[#a1a1a1]">No additional people have access yet.</p>
          ) : (
            collaborators.map((collaborator) => (
              <div key={`${collaborator.boardId}-${collaborator.email}`} className="flex items-center gap-3 border-b border-[rgba(255,255,255,0.1)] px-4 py-3 last:border-b-0">
                <span className="grid h-8 w-8 shrink-0 place-items-center border border-[rgba(255,255,255,0.1)] text-[#a1a1a1]">
                  <UserRound size={14} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-[#fafafa]">{collaborator.email}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.45px] text-[#a1a1a1]">Collaborator</p>
                </div>
                <select
                  value={collaborator.permission}
                  onChange={(event) =>
                    void onUpdatePermission(collaborator.email, event.target.value as BoardPermission)
                  }
                  disabled={collaboratorActionEmail === collaborator.email}
                  className="h-7 shrink-0 border border-[rgba(255,255,255,0.15)] bg-[#171717] px-1.5 text-[10px] uppercase tracking-[0.45px] text-[#a1a1a1] outline-none hover:border-[#737373] focus:border-[#fafafa] disabled:opacity-50"
                  aria-label={`Permission for ${collaborator.email}`}
                >
                  <option value="view">Read</option>
                  <option value="edit">Write</option>
                </select>
                <button
                  type="button"
                  className="grid h-7 w-7 shrink-0 place-items-center text-[#a1a1a1] hover:text-[#f52f39] disabled:opacity-50"
                  onClick={() => void onRemoveCollaborator(collaborator.email)}
                  disabled={collaboratorActionEmail === collaborator.email}
                  aria-label={`Remove ${collaborator.email}`}
                  title={`Remove ${collaborator.email}`}
                >
                  {collaboratorActionEmail === collaborator.email ? "..." : <Trash2 size={14} aria-hidden="true" />}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}