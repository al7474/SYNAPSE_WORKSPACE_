"use client";

import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Eye, Link2, Pencil, X } from "lucide-react";
import type { Board, BoardPermission } from "@/types/workspace";

type SharePermissionDialogProps = {
  board: Board;
  permission: BoardPermission;
  isSubmitting: boolean;
  onPermissionChange: (permission: BoardPermission) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

function permissionOptionClass(isSelected: boolean): string {
  return isSelected
    ? "border-foreground bg-secondary text-foreground"
    : "border-overlay/10 text-muted-foreground hover:border-subtle hover:text-foreground";
}

export function SharePermissionDialog({
  board,
  permission,
  isSubmitting,
  onPermissionChange,
  onCancel,
  onConfirm,
}: SharePermissionDialogProps) {
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-shade/75 p-4" role="presentation">
      <div
        className="w-full max-w-90 border border-overlay/15 bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-permission-title"
      >
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-micro uppercase tracking-label-lg text-muted-foreground">Share board</p>
            <Heading level={2} id="share-permission-title" className="mt-1 text-sm text-foreground">
              Generate access link
            </Heading>
            <p className="mt-1 truncate text-label text-muted-foreground">{board.name}</p>
          </div>
          <Button variant="unstyled"
            type="button"
            className="grid h-7 w-7 shrink-0 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Close share dialog"
            title="Close share dialog"
          >
            <X size={14} aria-hidden="true" />
          </Button>
        </div>

        <div className="border-t border-overlay/10 p-4">
          <p className="text-micro uppercase tracking-label-lg text-muted-foreground">Access type</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button variant="unstyled"
              type="button"
              className={`flex min-h-17 flex-col items-start justify-between gap-2 border p-3 text-left text-micro uppercase tracking-label transition-colors ${permissionOptionClass(permission === "view")}`}
              onClick={() => onPermissionChange("view")}
              disabled={isSubmitting}
              aria-pressed={permission === "view"}
            >
              <Eye size={15} aria-hidden="true" />
              <span>Read</span>
            </Button>
            <Button variant="unstyled"
              type="button"
              className={`flex min-h-17 flex-col items-start justify-between gap-2 border p-3 text-left text-micro uppercase tracking-label transition-colors ${permissionOptionClass(permission === "edit")}`}
              onClick={() => onPermissionChange("edit")}
              disabled={isSubmitting}
              aria-pressed={permission === "edit"}
            >
              <Pencil size={15} aria-hidden="true" />
              <span>Write</span>
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-overlay/10 p-4">
          <Button variant="unstyled"
            type="button"
            className="border border-overlay/10 px-3 py-2 text-micro uppercase tracking-label text-muted-foreground hover:border-subtle hover:text-foreground disabled:opacity-50"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button variant="unstyled"
            type="button"
            className="inline-flex items-center gap-2 border border-foreground bg-foreground px-3 py-2 text-micro uppercase tracking-label text-background hover:bg-primary-pressed disabled:cursor-wait disabled:opacity-50"
            onClick={() => void onConfirm()}
            disabled={isSubmitting}
          >
            <Link2 size={14} aria-hidden="true" />
            {isSubmitting
              ? "Generating..."
              : board.shareLinkActive
                ? "Replace link"
                : "Generate link"}
          </Button>
        </div>
      </div>
    </div>
  );
}