"use client";

import { LogOut, Menu, X } from "lucide-react";

type WorkspaceHeaderProps = {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onLogout: () => void;
};

export function WorkspaceHeader({ isSidebarOpen, onToggleSidebar, onLogout }: WorkspaceHeaderProps) {
  return (
    <header className="z-50 flex h-[51px] shrink-0 items-center justify-between border-b border-[#444748] bg-[#0e0e0e] px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center border border-[#444748] text-[#c4c7c8] lg:hidden"
          onClick={onToggleSidebar}
          aria-expanded={isSidebarOpen}
          aria-controls="workspace-sidebar"
          aria-label={isSidebarOpen ? "Close workspace navigation" : "Open workspace navigation"}
        >
          {isSidebarOpen ? <X size={17} /> : <Menu size={17} />}
        </button>
        <div className="grid h-8 w-8 place-items-center border border-[#353535] bg-[#1f2020] text-[10px] tracking-widest text-[#c4c7c8]">
          SY
        </div>
        <strong className="truncate text-sm font-medium sm:text-base">Synapse Workspace</strong>
      </div>
      <button
        type="button"
        className="flex h-8 shrink-0 items-center gap-2 border border-[#444748] px-2 text-sm text-[#c4c7c8] hover:text-white sm:px-3"
        onClick={onLogout}
        aria-label="Log out"
        title="Log out"
      >
        <LogOut size={16} />
        <span className="hidden sm:inline">Log Out</span>
      </button>
    </header>
  );
}
