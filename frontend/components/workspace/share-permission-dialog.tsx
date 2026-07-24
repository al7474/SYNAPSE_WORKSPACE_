"use client";

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
    ? "border-[#fafafa] bg-[#262626] text-[#fafafa]"
    : "border-[rgba(255,255,255,0.1)] text-[#a1a1a1] hover:border-[#737373] hover:text-[#fafafa]";
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
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/75 p-4" role="presentation">
      <div
        className="w-full max-w-90 border border-[rgba(255,255,255,0.15)] bg-[#171717] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-permission-title"
      >
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.55px] text-[#a1a1a1]">Share board</p>
            <h2 id="share-permission-title" className="mt-1 text-sm text-[#fafafa]">
              Generate access link
            </h2>
            <p className="mt-1 truncate text-[11px] text-[#a1a1a1]">{board.name}</p>
          </div>
          <button
            type="button"
            className="grid h-7 w-7 shrink-0 place-items-center text-[#a1a1a1] hover:text-[#fafafa] disabled:opacity-50"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Close share dialog"
            title="Close share dialog"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="border-t border-[rgba(255,255,255,0.1)] p-4">
          <p className="text-[10px] uppercase tracking-[0.55px] text-[#a1a1a1]">Access type</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`flex min-h-17 flex-col items-start justify-between gap-2 border p-3 text-left text-[10px] uppercase tracking-[0.45px] transition-colors ${permissionOptionClass(permission === "view")}`}
              onClick={() => onPermissionChange("view")}
              disabled={isSubmitting}
              aria-pressed={permission === "view"}
            >
              <Eye size={15} aria-hidden="true" />
              <span>Read</span>
            </button>
            <button
              type="button"
              className={`flex min-h-17 flex-col items-start justify-between gap-2 border p-3 text-left text-[10px] uppercase tracking-[0.45px] transition-colors ${permissionOptionClass(permission === "edit")}`}
              onClick={() => onPermissionChange("edit")}
              disabled={isSubmitting}
              aria-pressed={permission === "edit"}
            >
              <Pencil size={15} aria-hidden="true" />
              <span>Write</span>
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[rgba(255,255,255,0.1)] p-4">
          <button
            type="button"
            className="border border-[rgba(255,255,255,0.1)] px-3 py-2 text-[10px] uppercase tracking-[0.45px] text-[#a1a1a1] hover:border-[#737373] hover:text-[#fafafa] disabled:opacity-50"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 border border-[#fafafa] bg-[#fafafa] px-3 py-2 text-[10px] uppercase tracking-[0.45px] text-[#0a0a0a] hover:bg-[#d4d4d4] disabled:cursor-wait disabled:opacity-50"
            onClick={() => void onConfirm()}
            disabled={isSubmitting}
          >
            <Link2 size={14} aria-hidden="true" />
            {isSubmitting
              ? "Generating..."
              : board.shareLinkActive
                ? "Replace link"
                : "Generate link"}
          </button>
        </div>
      </div>
    </div>
  );
}