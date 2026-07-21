"use client";

import { useState } from "react";
import { AuthScreen } from "@/components/auth/auth-screen";
import { SessionLoadingScreen } from "@/components/auth/session-loading-screen";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useBoards } from "@/hooks/use-boards";
import { useNotes } from "@/hooks/use-notes";
import { useToasts } from "@/hooks/use-toasts";
import type { AuthMode, Board } from "@/types/workspace";

export default function HomePage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [, setStatus] = useState("Initializing secure workspace environment...");
  const { toasts, pushToast } = useToasts();

  const auth = useAuthSession({
    onStatusChange: setStatus,
    pushToast,
  });

  const boards = useBoards({
    sessionId: auth.sessionId,
    currentUserEmail: auth.currentUserEmail,
    onStatusChange: setStatus,
    pushToast,
  });

  const notes = useNotes({
    sessionId: auth.sessionId,
    currentUserEmail: auth.currentUserEmail,
    activeBoardId: boards.activeBoardId,
    activeShareToken: boards.activeShareToken,
    canEditBoard: boards.canEditBoard,
    onStatusChange: setStatus,
    pushToast,
  });

  const handleLogout = () => {
    setIsSidebarOpen(false);
    boards.resetBoards();
    notes.resetNotes();
    auth.clearSession();
  };

  const handleDeleteBoard = async (board: Board) => {
    const wasActiveBoard = board.id === boards.activeBoardId;
    await boards.handleDeleteBoard(board);

    if (wasActiveBoard) {
      notes.resetNotes();
    }
  };

  const handleAuthModeChange = (mode: AuthMode) => {
    auth.setAuthMode(mode);
    auth.setAuthError("");
  };

  if (auth.isHydratingSession) {
    return <SessionLoadingScreen />;
  }

  if (!auth.sessionId || !auth.sessionMode) {
    return (
      <AuthScreen
        authMode={auth.authMode}
        authName={auth.authName}
        authEmail={auth.authEmail}
        authPassword={auth.authPassword}
        authConfirmPassword={auth.authConfirmPassword}
        authError={auth.authError}
        isSigningIn={auth.isSigningIn}
        onAuthModeChange={handleAuthModeChange}
        onNameChange={auth.setAuthName}
        onEmailChange={auth.setAuthEmail}
        onPasswordChange={auth.setAuthPassword}
        onConfirmPasswordChange={auth.setAuthConfirmPassword}
        onAuthErrorChange={auth.setAuthError}
        onGuestAccess={auth.handleGuestAccess}
        onSignIn={auth.handleSignIn}
        onRegister={auth.handleRegister}
      />
    );
  }

  return (
    <WorkspaceShell
      header={{
        isSidebarOpen,
        onToggleSidebar: () => setIsSidebarOpen((isOpen) => !isOpen),
        onLogout: handleLogout,
      }}
      sidebar={{
        boards: boards.boards,
        activeBoardId: boards.activeBoardId,
        sessionId: auth.sessionId,
        sessionMode: auth.sessionMode,
        currentUserEmail: auth.currentUserEmail,
        isSidebarOpen,
        isCreatingBoard: boards.isCreatingBoard,
        deletingBoardId: boards.deletingBoardId,
        onClose: () => setIsSidebarOpen(false),
        onResetSearch: () => notes.setSearchText(""),
        onSelectBoard: boards.selectBoard,
        onDeleteBoard: handleDeleteBoard,
        onCreateBoard: boards.handleCreateBoard,
      }}
      content={{
        searchText: notes.searchText,
        activeBoard: boards.activeBoard,
        visibleNotes: notes.visibleNotes,
        semanticResults: notes.semanticResults,
        isLoading: notes.isLoading,
        isBoardsLoading: boards.isBoardsLoading,
        canEditBoard: boards.canEditBoard,
        isCreating: notes.isCreating,
        selectedId: notes.selectedId,
        selectedNote: notes.selectedNote,
        draftTitle: notes.draftTitle,
        draftContent: notes.draftContent,
        lastSavedAt: notes.lastSavedAt,
        isDeleting: notes.isDeleting,
        onSearchTextChange: notes.setSearchText,
        onRefreshBoards: boards.loadBoards,
        onShareBoard: boards.handleShareBoard,
        onSelectNote: notes.setSelectedId,
        onCreateNote: notes.handleCreateNote,
        onDraftTitleChange: notes.setDraftTitle,
        onDraftContentChange: notes.setDraftContent,
        onRequestDelete: () => notes.setShowDeleteConfirm(true),
      }}
      deleteDialog={{
        open: notes.showDeleteConfirm,
        isDeleting: notes.isDeleting,
        onCancel: () => notes.setShowDeleteConfirm(false),
        onConfirm: notes.handleDeleteSelected,
      }}
      toasts={toasts}
    />
  );
}
