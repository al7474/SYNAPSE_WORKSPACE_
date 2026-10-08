"use client";

import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
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
    ? "border-success/40 text-success-foreground"
    : "border-overlay/15 text-muted-foreground";
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
    <section className="mb-5 border border-overlay/10 bg-card-translucent/55" aria-labelledby="board-access-title">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-micro uppercase tracking-label-lg text-muted-foreground">Board access</p>
          <Heading level={2} id="board-access-title" className="mt-1 truncate text-sm text-foreground">
            People and permissions
          </Heading>
          <p className="mt-1 truncate text-label text-muted-foreground">{board.name}</p>
        </div>
        <Button variant="unstyled"
          type="button"
          className="grid h-7 w-7 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close board access"
          title="Close board access"
        >
          <X size={14} aria-hidden="true" />
        </Button>
      </div>

      <div className="border-t border-overlay/10">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center border border-overlay/10 text-muted-foreground">
            <UserRound size={14} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-foreground">{currentUserEmail || "You"}</p>
            <p className="mt-1 text-micro uppercase tracking-label text-muted-foreground">Board owner</p>
          </div>
          <span className={`border px-2 py-1 text-micro uppercase tracking-label ${permissionBadgeClass("edit")}`}>
            Write
          </span>
        </div>

        {board.shareLinkActive && (
          <div className="flex items-center gap-3 border-t border-overlay/10 px-4 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center border border-success/35 text-success-foreground">
              <Link2 size={14} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-foreground">Anyone with the active link</p>
              <p className="mt-1 text-micro uppercase tracking-label text-muted-foreground">
                {permissionLabel(board.sharePermission)} access
              </p>
            </div>
            <span
              className={`border px-2 py-1 text-micro uppercase tracking-label ${permissionBadgeClass(board.sharePermission)}`}
            >
              {permissionLabel(board.sharePermission)}
            </span>
          </div>
        )}

        <div className="border-t border-overlay/10">
          {isLoading ? (
            <p className="px-4 py-4 text-label text-muted-foreground">Loading people with access...</p>
          ) : collaborators.length === 0 ? (
            <p className="px-4 py-4 text-label text-muted-foreground">No additional people have access yet.</p>
          ) : (
            collaborators.map((collaborator) => (
              <div key={`${collaborator.boardId}-${collaborator.email}`} className="flex items-center gap-3 border-b border-overlay/10 px-4 py-3 last:border-b-0">
                <span className="grid h-8 w-8 shrink-0 place-items-center border border-overlay/10 text-muted-foreground">
                  <UserRound size={14} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-foreground">{collaborator.email}</p>
                  <p className="mt-1 text-micro uppercase tracking-label text-muted-foreground">Collaborator</p>
                </div>
                <select
                  value={collaborator.permission}
                  onChange={(event) =>
                    void onUpdatePermission(collaborator.email, event.target.value as BoardPermission)
                  }
                  disabled={collaboratorActionEmail === collaborator.email}
                  className="h-7 shrink-0 border border-overlay/15 bg-card px-1.5 text-micro uppercase tracking-label text-muted-foreground outline-none hover:border-subtle focus:border-foreground disabled:opacity-50"
                  aria-label={`Permission for ${collaborator.email}`}
                >
                  <option value="view">Read</option>
                  <option value="edit">Write</option>
                </select>
                <Button variant="unstyled"
                  type="button"
                  className="grid h-7 w-7 shrink-0 place-items-center text-muted-foreground hover:text-danger disabled:opacity-50"
                  onClick={() => void onRemoveCollaborator(collaborator.email)}
                  disabled={collaboratorActionEmail === collaborator.email}
                  aria-label={`Remove ${collaborator.email}`}
                  title={`Remove ${collaborator.email}`}
                >
                  {collaboratorActionEmail === collaborator.email ? "..." : <Trash2 size={14} aria-hidden="true" />}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}