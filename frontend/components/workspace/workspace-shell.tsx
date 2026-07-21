"use client";

import { Search } from "lucide-react";
import type { ComponentProps } from "react";
import { DeleteNoteDialog } from "@/components/workspace/delete-note-dialog";
import { ToastViewport } from "@/components/workspace/toast-viewport";
import { WorkspaceContent } from "@/components/workspace/workspace-content";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";

type WorkspaceShellProps = {
  header: ComponentProps<typeof WorkspaceHeader>;
  sidebar: ComponentProps<typeof WorkspaceSidebar>;
  content: ComponentProps<typeof WorkspaceContent>;
  deleteDialog: ComponentProps<typeof DeleteNoteDialog>;
  toasts: ComponentProps<typeof ToastViewport>["toasts"];
};

export function WorkspaceShell({ header, sidebar, content, deleteDialog, toasts }: WorkspaceShellProps) {
  return (
    <main className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-[#0a0a0a] font-mono text-[#fafafa]">
      <WorkspaceHeader {...header} />

      <div className="shrink-0 border-b border-[rgba(255,255,255,0.1)] px-4 pb-[13px] pt-3">
        <div className="flex h-[42px] items-center gap-3 border border-[rgba(255,255,255,0.1)] bg-[rgba(23,23,23,0.4)] px-[17px]">
          <Search size={16} className="shrink-0 text-[#a1a1a1]" aria-hidden="true" />
          <input
            value={content.searchText}
            onChange={(event) => content.onSearchTextChange(event.target.value)}
            placeholder="Search boards and notes"
            aria-label="Search boards and notes"
            className="min-w-0 flex-1 bg-transparent text-xs text-[#fafafa] outline-none placeholder:text-[#a1a1a1]"
          />
        </div>
      </div>

      <div className="relative flex min-h-[calc(100vh-130px)] min-w-0 flex-1">
        <WorkspaceSidebar {...sidebar} />
        <WorkspaceContent {...content} />
      </div>

      <DeleteNoteDialog {...deleteDialog} />
      <ToastViewport toasts={toasts} />
    </main>
  );
}
