"use client";

import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import type { ComponentProps } from "react";
import { EmailVerificationBanner } from "@/components/auth/email-verification-banner";
import { DeleteNoteDialog } from "@/components/workspace/delete-note-dialog";
import { ToastViewport } from "@/components/workspace/toast-viewport";
import { WorkspaceContent } from "@/components/workspace/workspace-content";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";

type WorkspaceShellProps = {
  emailVerification?: ComponentProps<typeof EmailVerificationBanner>;
  header: ComponentProps<typeof WorkspaceHeader>;
  sidebar: ComponentProps<typeof WorkspaceSidebar>;
  content: ComponentProps<typeof WorkspaceContent>;
  deleteDialog: ComponentProps<typeof DeleteNoteDialog>;
  toasts: ComponentProps<typeof ToastViewport>["toasts"];
};

export function WorkspaceShell({ emailVerification, header, sidebar, content, deleteDialog, toasts }: WorkspaceShellProps) {
  return (
    <main className="flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-background font-mono text-foreground">
      <WorkspaceHeader {...header} />
      {emailVerification && <EmailVerificationBanner {...emailVerification} />}

      <div className="shrink-0 border-b border-overlay/10 px-4 pb-inset pt-3">
        <div className="flex h-control items-center gap-3 border border-overlay/10 bg-card-translucent/40 px-inset-lg">
          <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input variant="unstyled"
            value={content.searchText}
            onChange={(event) => content.onSearchTextChange(event.target.value)}
            placeholder="Search boards and notes"
            aria-label="Search boards and notes"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1">
        <WorkspaceSidebar {...sidebar} />
        <WorkspaceContent {...content} />
      </div>

      <DeleteNoteDialog {...deleteDialog} />
      <ToastViewport toasts={toasts} />
    </main>
  );
}
