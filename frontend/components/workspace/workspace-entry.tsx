"use client";

import { useRef, useState } from "react";
import { DeleteDemoWorkspaceDialog } from "@/components/workspace/delete-demo-workspace-dialog";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { useBoards } from "@/hooks/use-boards";
import { useNotes } from "@/hooks/use-notes";
import type { useAuthSession } from "@/hooks/use-auth-session";
import type { useToasts } from "@/hooks/use-toasts";
import type { Board, SessionMode } from "@/types/workspace";

type WorkspaceEntryProps = {
  auth: ReturnType<typeof useAuthSession> & {
    sessionId: string;
    sessionMode: SessionMode;
  };
  pushToast: ReturnType<typeof useToasts>["pushToast"];
  toasts: ReturnType<typeof useToasts>["toasts"];
  onStatusChange: (status: string) => void;
};

export default function WorkspaceEntry({
  auth,
  pushToast,
  toasts,
  onStatusChange,
}: WorkspaceEntryProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);
  const [isDeletingDemoWorkspace, setIsDeletingDemoWorkspace] = useState(false);
  const [isDemoDeleteDialogOpen, setIsDemoDeleteDialogOpen] = useState(false);
  const [demoDeleteError, setDemoDeleteError] = useState("");
  const [accessBoardId, setAccessBoardId] = useState<string | null>(null);
  const isDeletingDemoWorkspaceRef = useRef(false);
  const canManageSharing = auth.sessionMode !== "user" || auth.emailVerified;

  const boards = useBoards({
    sessionId: auth.sessionId,
    canManageSharing,
    onStatusChange,
    pushToast,
  });

  const notes = useNotes({
    sessionId: auth.sessionId,
    activeBoardId: boards.activeBoardId,
    activeShareToken: boards.activeShareToken,
    canEditBoard: boards.canEditBoard,
    onStatusChange,
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

  const handleOpenDeleteDemoWorkspace = () => {
    if (auth.sessionMode !== "guest" || isDeletingDemoWorkspaceRef.current) {
      return;
    }

    setDemoDeleteError("");
    setIsDemoDeleteDialogOpen(true);
  };

  const handleCancelDeleteDemoWorkspace = () => {
    if (isDeletingDemoWorkspaceRef.current) {
      return;
    }

    setDemoDeleteError("");
    setIsDemoDeleteDialogOpen(false);
  };

  const handleDeleteDemoWorkspace = async () => {
    if (auth.sessionMode !== "guest" || isDeletingDemoWorkspaceRef.current) {
      return;
    }

    isDeletingDemoWorkspaceRef.current = true;
    setIsDeletingDemoWorkspace(true);
    setDemoDeleteError("");

    try {
      await auth.deleteDemoWorkspace();

      setIsSidebarOpen(false);
      setIsNoteEditorOpen(false);
      setAccessBoardId(null);
      boards.resetBoards();
      notes.resetNotes();
      setIsDemoDeleteDialogOpen(false);
      onStatusChange("Demo workspace deleted");
      pushToast("success", "Demo workspace deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete demo workspace";
      setDemoDeleteError(message);
      onStatusChange(message);
      pushToast("error", message);
    } finally {
      isDeletingDemoWorkspaceRef.current = false;
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

  return (
    <>
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
        onDeleteDemoWorkspace: handleOpenDeleteDemoWorkspace,
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
        onReorderNote: notes.handleReorderNote,
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
    <DeleteDemoWorkspaceDialog
      open={isDemoDeleteDialogOpen}
      isDeleting={isDeletingDemoWorkspace}
      error={demoDeleteError}
      onCancel={handleCancelDeleteDemoWorkspace}
      onConfirm={handleDeleteDemoWorkspace}
    />
    </>
  );
}
