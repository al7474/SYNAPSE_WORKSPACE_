"use client";

import { LogOut, Menu, X } from "lucide-react";

type WorkspaceHeaderProps = {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onLogout: () => void;
};

export function WorkspaceHeader({ isSidebarOpen, onToggleSidebar, onLogout }: WorkspaceHeaderProps) {
  return (
    <header className="z-50 flex h-[61px] shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.1)] bg-[#0a0a0a] px-4">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center border border-[rgba(255,255,255,0.1)] text-[#a1a1a1] lg:hidden"
          onClick={onToggleSidebar}
          aria-expanded={isSidebarOpen}
          aria-controls="workspace-sidebar"
          aria-label={isSidebarOpen ? "Close workspace navigation" : "Open workspace navigation"}
        >
          {isSidebarOpen ? <X size={17} /> : <Menu size={17} />}
        </button>
        <div className="grid h-9 w-9 place-items-center border border-[rgba(255,255,255,0.1)] bg-[#262626] text-[11px] tracking-[0.55px] text-[#fafafa]">
          88
        </div>
      </div>
      <button
        type="button"
        className="flex h-9 shrink-0 items-center gap-2 border border-[rgba(255,255,255,0.1)] px-[13px] py-[9px] text-[11px] uppercase tracking-[0.55px] text-[#fafafa] hover:border-[#737373]"
        onClick={onLogout}
        aria-label="Log out"
        title="Log out"
      >
        <LogOut size={14} aria-hidden="true" />
        <span>Log Out</span>
      </button>
    </header>
  );
}
