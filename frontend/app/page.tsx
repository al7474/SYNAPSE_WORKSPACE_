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
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);
  const [isDeletingDemoWorkspace, setIsDeletingDemoWorkspace] = useState(false);
  const [accessBoardId, setAccessBoardId] = useState<string | null>(null);
  const [, setStatus] = useState("Initializing secure workspace environment...");
  const { toasts, pushToast } = useToasts();

  const auth = useAuthSession({
    onStatusChange: setStatus,
    pushToast,
  });

  const workspaceSessionId = auth.sessionId;
  const canManageSharing = auth.sessionMode !== "user" || auth.emailVerified;

  const boards = useBoards({
    sessionId: workspaceSessionId,
    canManageSharing,
    onStatusChange: setStatus,
    pushToast,
  });

  const notes = useNotes({
    sessionId: workspaceSessionId,
    activeBoardId: boards.activeBoardId,
    activeShareToken: boards.activeShareToken,
    canEditBoard: boards.canEditBoard,
    onStatusChange: setStatus,
    pushToast,
  });

  const handleLogout = () => {
    setIsSidebarOpen(false);
    setIsNoteEditorOpen(false);
    setAccessBoardId(null);
    boards.resetBoards();
    notes.resetNotes();
    void auth.clearSession();
  };

  const handleDeleteDemoWorkspace = async () => {
    if (auth.sessionMode !== "guest") {
      return;
    }

    const shouldDelete = window.confirm(
      "Delete this demo workspace? All boards and notes in this temporary session will be permanently removed."
    );

    if (!shouldDelete) {
      return;
    }

    setIsDeletingDemoWorkspace(true);
    setIsSidebarOpen(false);
    setIsNoteEditorOpen(false);
    setAccessBoardId(null);
    boards.resetBoards();
    notes.resetNotes();

    try {
      const deleted = await auth.clearSession();

      if (deleted) {
        setStatus("Demo workspace deleted");
        pushToast("success", "Demo workspace deleted");
      }
    } finally {
      setIsDeletingDemoWorkspace(false);
    }
  };

  const handleSelectBoard = (board: Board) => {
    setIsNoteEditorOpen(false);
    setAccessBoardId(null);
    boards.selectBoard(board);
  };

  const handleShowBoardAccess = (board: Board) => {
    setIsNoteEditorOpen(false);
    setAccessBoardId(board.id);
    boards.selectBoard(board);
    setIsSidebarOpen(false);
  };

  const handleDeleteBoard = async (board: Board) => {
    const wasActiveBoard = board.id === boards.activeBoardId;
    await boards.handleDeleteBoard(board);

    if (wasActiveBoard) {
      setIsNoteEditorOpen(false);
      notes.resetNotes();
    }
  };

  const handleSelectNote = (noteId: string) => {
    notes.setSelectedId(noteId);
    setIsNoteEditorOpen(true);
  };

  const handleCreateNote = async () => {
    const created = await notes.handleCreateNote();

    if (created) {
      setIsNoteEditorOpen(true);
    }
  };

  const handleAuthModeChange = (mode: AuthMode) => {
    auth.setAuthMode(mode);
    auth.setAuthError("");
  };

  if (auth.isHydratingSession || auth.sessionHydrationError) {
    return (
      <SessionLoadingScreen
        error={auth.sessionHydrationError || undefined}
        onRetry={auth.sessionHydrationError ? auth.retrySessionHydration : undefined}
      />
    );
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
        onForgotPassword={auth.handleForgotPassword}
      />
    );
  }

  return (
    <WorkspaceShell
      emailVerification={
        auth.sessionMode === "user" && !auth.emailVerified
          ? {
              email: auth.currentUserEmail,
              error: auth.authError,
              isSubmitting: auth.isSigningIn,
              onResend: auth.handleRequestEmailVerification,
              onCheck: auth.checkEmailVerification,
            }
          : undefined
      }
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
        canManageSharing,
        currentUserEmail: auth.currentUserEmail,
        isSidebarOpen,
        isCreatingBoard: boards.isCreatingBoard,
        deletingBoardId: boards.deletingBoardId,
        isDeletingDemoWorkspace,
        onClose: () => setIsSidebarOpen(false),
        onResetSearch: () => notes.setSearchText(""),
        onSelectBoard: handleSelectBoard,
        onDeleteBoard: handleDeleteBoard,
        onShareBoard: boards.handleShareBoard,
        onCopyShareLink: boards.handleCopyExistingShareLink,
        onRevokeShareLink: boards.handleRevokeShareLink,
        onShowBoardAccess: handleShowBoardAccess,
        onVerificationRequired: () => {
          pushToast("info", "Verify your email to manage sharing and collaborators");
        },
        onCreateBoard: boards.handleCreateBoard,
        onDeleteDemoWorkspace: handleDeleteDemoWorkspace,
      }}
      content={{
        searchText: notes.searchText,
        activeBoard: boards.activeBoard,
        currentUserEmail: auth.currentUserEmail,
        showBoardAccess: accessBoardId === boards.activeBoardId,
        collaborators: boards.collaborators,
        isCollaboratorsLoading: boards.isCollaboratorsLoading,
        collaboratorActionEmail: boards.collaboratorActionEmail,
        visibleNotes: notes.visibleNotes,
        semanticResults: notes.semanticResults,
        isLoading: notes.isLoading,
        isBoardsLoading: boards.isBoardsLoading,
        canEditBoard: boards.canEditBoard,
        isCreating: notes.isCreating,
        isNoteEditorOpen,
        selectedId: notes.selectedId,
        selectedNote: notes.selectedNote,
        draftTitle: notes.draftTitle,
        draftContent: notes.draftContent,
        lastSavedAt: notes.lastSavedAt,
        isDeleting: notes.isDeleting,
        onSearchTextChange: notes.setSearchText,
        onRefreshBoards: boards.loadBoards,
        onCloseBoardAccess: () => setAccessBoardId(null),
        onUpdateCollaboratorPermission: boards.handleUpdateCollaboratorPermission,
        onRemoveCollaborator: boards.handleRemoveCollaborator,
        onSelectNote: handleSelectNote,
        onCreateNote: handleCreateNote,
        onCloseNote: () => setIsNoteEditorOpen(false),
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
