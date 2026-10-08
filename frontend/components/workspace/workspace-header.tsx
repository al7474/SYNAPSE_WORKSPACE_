"use client";

import { Button } from "@/components/ui/button";
import { LogOut, Menu, X } from "lucide-react";

type WorkspaceHeaderProps = {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onLogout: () => void;
};

export function WorkspaceHeader({ isSidebarOpen, onToggleSidebar, onLogout }: WorkspaceHeaderProps) {
  return (
    <header className="z-50 flex h-row-lg shrink-0 items-center justify-between border-b border-overlay/10 bg-background px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="unstyled"
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center border border-overlay/10 text-muted-foreground md:hidden"
          onClick={onToggleSidebar}
          aria-expanded={isSidebarOpen}
          aria-controls="workspace-sidebar"
          aria-label={isSidebarOpen ? "Close workspace navigation" : "Open workspace navigation"}
        >
          {isSidebarOpen ? <X size={17} /> : <Menu size={17} />}
        </Button>
        <div className="grid h-9 w-9 place-items-center border border-overlay/10 bg-secondary text-label tracking-label-lg text-foreground">
          88
        </div>
      </div>
      <Button variant="unstyled"
        type="button"
        data-testid="logout"
        className="flex h-9 shrink-0 items-center gap-2 border border-overlay/10 px-inset py-inset-sm text-label uppercase tracking-label-lg text-foreground hover:border-subtle"
        onClick={onLogout}
        aria-label="Log out"
        title="Log out"
      >
        <LogOut size={14} aria-hidden="true" />
        <span>Log Out</span>
      </Button>
    </header>
  );
}
