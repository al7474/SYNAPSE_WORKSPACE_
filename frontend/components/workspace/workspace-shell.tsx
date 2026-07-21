"use client";

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
    <main className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-[#0e0e0e] font-mono text-white">
      <WorkspaceHeader {...header} />

      <div className="relative flex min-h-[calc(100vh-51px)] min-w-0 flex-1">
        <WorkspaceSidebar {...sidebar} />
        <WorkspaceContent {...content} />
      </div>

      <DeleteNoteDialog {...deleteDialog} />
      <ToastViewport toasts={toasts} />
    </main>
  );
}
