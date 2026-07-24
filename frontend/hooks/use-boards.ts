"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { graphQLRequest } from "@/lib/graphql-client";
import { buildShareLink, mergeBoards } from "@/lib/board-utils";
import type {
  Board,
  BoardCollaborator,
  BoardPermission,
  SharedBoardAccess,
  ToastKind,
} from "@/types/workspace";

type UseBoardsOptions = {
  sessionId: string;
  onStatusChange: (status: string) => void;
  pushToast: (kind: ToastKind, message: string) => void;
};

function readShareTokenFromLocation(): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get("share");
}

function clearShareTokenFromLocation(): void {
  const url = new URL(window.location.href);
  const hashParameters = new URLSearchParams(url.hash.slice(1));

  if (!hashParameters.has("share")) {
    return;
  }

  hashParameters.delete("share");
  const nextHash = hashParameters.toString();
  const nextUrl = `${url.pathname}${url.search}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState(window.history.state, document.title, nextUrl);
}

export function useBoards({ sessionId, onStatusChange, pushToast }: UseBoardsOptions) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardId, setActiveBoardId] = useState("");
  const [activeShareToken, setActiveShareToken] = useState<string | null>(null);
  const [activePermission, setActivePermission] = useState<BoardPermission>("edit");
  const [isBoardsLoading, setIsBoardsLoading] = useState(false);
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<BoardCollaborator[]>([]);
  const [isCollaboratorsLoading, setIsCollaboratorsLoading] = useState(false);
  const [collaboratorActionEmail, setCollaboratorActionEmail] = useState<string | null>(null);

  const activeBoard = useMemo(
    () => boards.find((board) => board.id === activeBoardId) || null,
    [activeBoardId, boards]
  );

  const canEditBoard = useMemo(() => {
    if (!activeBoard) {
      return false;
    }

    if (activeBoard.ownerId === sessionId) {
      return true;
    }

    return activePermission === "edit";
  }, [activeBoard, activePermission, sessionId]);

  const loadBoards = useCallback(async () => {
    if (!sessionId) {
      return;
    }

    setIsBoardsLoading(true);

    try {
      const data = await graphQLRequest<{ listBoards: Board[] }>(
        `
        query {
          listBoards {
            id
            ownerId
            name
            shareLinkActive
            sharePermission
          }
        }
        `
      );

      setBoards(data.listBoards);

      if (!activeBoardId && data.listBoards.length > 0) {
        setActiveBoardId(data.listBoards[0].id);
        setActiveShareToken(null);
        setActivePermission("edit");
      }
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Failed to load boards");
    } finally {
      setIsBoardsLoading(false);
    }
  }, [activeBoardId, onStatusChange, sessionId]);

  const loadCollaborators = useCallback(async () => {
    if (!activeBoard || activeBoard.ownerId !== sessionId) {
      setCollaborators([]);
      return;
    }

    setIsCollaboratorsLoading(true);

    try {
      const data = await graphQLRequest<{ listBoardCollaborators: BoardCollaborator[] }>(
        `
        query ListBoardCollaborators($boardId: ID!) {
          listBoardCollaborators(boardId: $boardId) {
            boardId
            email
            permission
          }
        }
        `,
        { boardId: activeBoard.id }
      );

      setCollaborators(data.listBoardCollaborators);
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Unable to load collaborators");
    } finally {
      setIsCollaboratorsLoading(false);
    }
  }, [activeBoard, onStatusChange, sessionId]);

  useEffect(() => {
    void loadBoards();
  }, [loadBoards]);

  useEffect(() => {
    void loadCollaborators();
  }, [loadCollaborators]);

  useEffect(() => {
    if (!sessionId || boards.length === 0) {
      return;
    }

    const shareToken = readShareTokenFromLocation();

    if (!shareToken) {
      return;
    }

    void (async () => {
      try {
        const data = await graphQLRequest<{ accessSharedBoard: SharedBoardAccess }>(
          `
          query AccessSharedBoard($token: String!) {
            accessSharedBoard(token: $token) {
              permission
              board {
                id
                ownerId
                name
                shareLinkActive
                sharePermission
              }
            }
          }
          `,
          { token: shareToken }
        );

        setBoards((previousBoards) => mergeBoards(previousBoards, data.accessSharedBoard.board));
        setActiveBoardId(data.accessSharedBoard.board.id);
        setActiveShareToken(shareToken);
        setActivePermission(data.accessSharedBoard.permission);
        clearShareTokenFromLocation();
        onStatusChange(
          data.accessSharedBoard.permission === "edit"
            ? "Shared board opened with edit access"
            : "Shared board opened in read-only mode"
        );
      } catch (error) {
        onStatusChange(error instanceof Error ? error.message : "Unable to open shared board");
      }
    })();
  }, [boards.length, onStatusChange, sessionId]);

  const selectBoard = useCallback(
    (board: Board) => {
      setActiveBoardId(board.id);

      if (board.ownerId === sessionId) {
        setActiveShareToken(null);
        setActivePermission("edit");
      }
    },
    [sessionId]
  );

  const handleCreateBoard = useCallback(async () => {
    const name = window.prompt("Board name", "Product roadmap");

    if (!name?.trim()) {
      return;
    }

    setIsCreatingBoard(true);

    try {
      const data = await graphQLRequest<{ createBoard: Board }>(
        `
        mutation CreateBoard($name: String!) {
          createBoard(name: $name) {
            id
            ownerId
            name
            shareLinkActive
            sharePermission
          }
        }
        `,
        { name: name.trim() }
      );

      setBoards((previousBoards) => [data.createBoard, ...previousBoards]);
      setActiveBoardId(data.createBoard.id);
      setActiveShareToken(null);
      setActivePermission("edit");
      onStatusChange("Board created");
      pushToast("success", "Board created");
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Create board failed");
      pushToast("error", "Unable to create board");
    } finally {
      setIsCreatingBoard(false);
    }
  }, [onStatusChange, pushToast, sessionId]);

  const handleDeleteBoard = useCallback(
    async (boardToDelete: Board) => {
      if (boardToDelete.ownerId !== sessionId) {
        pushToast("info", "Only board owner can delete this board");
        return;
      }

      const shouldDelete = window.confirm(
        `Delete board \"${boardToDelete.name}\"? This will permanently delete the board and all notes inside it.`
      );

      if (!shouldDelete) {
        return;
      }

      setDeletingBoardId(boardToDelete.id);

      try {
        const data = await graphQLRequest<{ deleteBoard: boolean }>(
          `
          mutation DeleteBoard($id: ID!) {
            deleteBoard(id: $id)
          }
          `,
          { id: boardToDelete.id }
        );

        if (!data.deleteBoard) {
          throw new Error("Board could not be deleted");
        }

        const nextBoards = boards.filter((board) => board.id !== boardToDelete.id);
        setBoards(nextBoards);

        if (boardToDelete.id === activeBoardId) {
          setActiveShareToken(null);
          setActivePermission("edit");
          setActiveBoardId(nextBoards[0]?.id ?? "");
        }

        if (nextBoards.length === 0) {
          await loadBoards();
        }

        onStatusChange("Board deleted");
        pushToast("success", "Board and related notes deleted");
      } catch (error) {
        onStatusChange(error instanceof Error ? error.message : "Delete board failed");
        pushToast("error", "Unable to delete board");
      } finally {
        setDeletingBoardId(null);
      }
    },
    [activeBoardId, boards, loadBoards, onStatusChange, pushToast, sessionId]
  );

  const handleShareBoard = useCallback(async (boardToShare?: Board, permission: BoardPermission = "view") => {
    const targetBoard = boardToShare ?? activeBoard;

    if (!targetBoard) {
      return;
    }

    if (targetBoard.ownerId !== sessionId) {
      pushToast("info", "Only board owner can regenerate share links");
      return;
    }

    try {
      const data = await graphQLRequest<{ createShareLink: string }>(
        `
        mutation CreateShareLink($boardId: ID!, $permission: BoardPermission!) {
          createShareLink(boardId: $boardId, permission: $permission)
        }
        `,
        { boardId: targetBoard.id, permission }
      );

      const link = buildShareLink(data.createShareLink);
      await navigator.clipboard.writeText(link);

      setBoards((previousBoards) =>
        previousBoards.map((board) =>
          board.id === targetBoard.id
              ? {
                  ...board,
                  shareLinkActive: true,
                  shareToken: data.createShareLink,
                  sharePermission: permission,
                }
            : board
        )
      );

      pushToast("success", "Share link copied to clipboard");
      onStatusChange(`Share link ready (${permission})`);
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Share link failed");
      pushToast("error", "Unable to create share link");
    }
  }, [activeBoard, onStatusChange, pushToast, sessionId]);

  const handleCopyExistingShareLink = useCallback(async (boardToCopy?: Board) => {
    const targetBoard = boardToCopy ?? activeBoard;

    if (!targetBoard?.shareToken) {
      pushToast(
        "info",
        targetBoard?.shareLinkActive
          ? "Generate a new link to copy"
          : "This board has no share link yet"
      );
      return;
    }

    try {
      await navigator.clipboard.writeText(buildShareLink(targetBoard.shareToken));
      onStatusChange("Share link copied again");
      pushToast("success", "Share link copied");
    } catch {
      pushToast("error", "Unable to copy share link");
    }
  }, [activeBoard, onStatusChange, pushToast]);

  const handleRevokeShareLink = useCallback(
    async (boardToRevoke?: Board) => {
      const targetBoard = boardToRevoke ?? activeBoard;

      if (!targetBoard || targetBoard.ownerId !== sessionId) {
        pushToast("info", "Only board owner can revoke share links");
        return;
      }

      if (!targetBoard.shareLinkActive) {
        pushToast("info", "This board has no active share link");
        return;
      }

      if (!window.confirm(`Revoke the share link for "${targetBoard.name}"?`)) {
        return;
      }

      try {
        const data = await graphQLRequest<{ revokeShareLink: boolean }>(
          `
          mutation RevokeShareLink($boardId: ID!) {
            revokeShareLink(boardId: $boardId)
          }
          `,
          { boardId: targetBoard.id }
        );

        if (!data.revokeShareLink) {
          throw new Error("Share link could not be revoked");
        }

        setBoards((previousBoards) =>
          previousBoards.map((board) =>
            board.id === targetBoard.id
              ? { ...board, shareLinkActive: false, shareToken: null }
              : board
          )
        );

        if (activeBoardId === targetBoard.id) {
          setActiveShareToken(null);
          setActivePermission("edit");
        }

        onStatusChange("Share link revoked");
        pushToast("success", "Share link revoked");
      } catch (error) {
        onStatusChange(error instanceof Error ? error.message : "Unable to revoke share link");
        pushToast("error", "Unable to revoke share link");
      }
    },
    [activeBoard, activeBoardId, onStatusChange, pushToast, sessionId]
  );

  const handleGrantAccessByEmail = useCallback(async () => {
    if (!activeBoard || activeBoard.ownerId !== sessionId) {
      pushToast("info", "Only board owner can grant email access");
      return;
    }

    const email = window.prompt("Collaborator email", "")?.trim().toLowerCase();

    if (!email || !email.includes("@")) {
      pushToast("error", "Please provide a valid email");
      return;
    }

    const permissionInput = window.prompt("Permission: view or edit", "view")?.trim().toLowerCase();

    if (permissionInput !== "view" && permissionInput !== "edit") {
      pushToast("error", "Permission must be view or edit");
      return;
    }

    const permission = permissionInput as BoardPermission;

    try {
      await graphQLRequest<{ setBoardCollaborator: BoardCollaborator }>(
        `
        mutation SetBoardCollaborator($boardId: ID!, $email: String!, $permission: BoardPermission!) {
          setBoardCollaborator(boardId: $boardId, email: $email, permission: $permission) {
            boardId
            email
            permission
          }
        }
        `,
        { boardId: activeBoard.id, email, permission }
      );

      pushToast("success", `Access updated for ${email}`);
      onStatusChange(`Collaborator ${email} -> ${permission}`);
      await loadCollaborators();
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Unable to grant access");
      pushToast("error", "Unable to grant access");
    }
  }, [activeBoard, loadCollaborators, onStatusChange, pushToast, sessionId]);

  const handleUpdateCollaboratorPermission = useCallback(
    async (email: string, permission: BoardPermission) => {
      if (!activeBoard || activeBoard.ownerId !== sessionId) {
        pushToast("info", "Only board owner can update collaborator access");
        return;
      }

      setCollaboratorActionEmail(email);

      try {
        const data = await graphQLRequest<{ setBoardCollaborator: BoardCollaborator }>(
          `
          mutation SetBoardCollaborator($boardId: ID!, $email: String!, $permission: BoardPermission!) {
            setBoardCollaborator(boardId: $boardId, email: $email, permission: $permission) {
              boardId
              email
              permission
            }
          }
          `,
          { boardId: activeBoard.id, email, permission }
        );

        setCollaborators((previousCollaborators) =>
          previousCollaborators.map((collaborator) =>
            collaborator.email === email ? data.setBoardCollaborator : collaborator
          )
        );
        pushToast("success", `Access updated for ${email}`);
        onStatusChange(`Collaborator ${email} -> ${permission}`);
      } catch (error) {
        onStatusChange(error instanceof Error ? error.message : "Unable to update collaborator access");
        pushToast("error", "Unable to update collaborator access");
      } finally {
        setCollaboratorActionEmail(null);
      }
    },
    [activeBoard, onStatusChange, pushToast, sessionId]
  );

  const handleRemoveCollaborator = useCallback(
    async (email: string) => {
      if (!activeBoard || activeBoard.ownerId !== sessionId) {
        return;
      }

      const shouldRemove = window.confirm(`Remove ${email} from this board?`);

      if (!shouldRemove) {
        return;
      }

      setCollaboratorActionEmail(email);

      try {
        const data = await graphQLRequest<{ removeBoardCollaborator: boolean }>(
          `
          mutation RemoveBoardCollaborator($boardId: ID!, $email: String!) {
            removeBoardCollaborator(boardId: $boardId, email: $email)
          }
          `,
          { boardId: activeBoard.id, email }
        );

        if (!data.removeBoardCollaborator) {
          throw new Error("Collaborator not removed");
        }

        setCollaborators((previousCollaborators) =>
          previousCollaborators.filter((collaborator) => collaborator.email !== email)
        );
        pushToast("success", `Removed ${email}`);
      } catch (error) {
        onStatusChange(error instanceof Error ? error.message : "Unable to remove collaborator");
        pushToast("error", "Unable to remove collaborator");
      } finally {
        setCollaboratorActionEmail(null);
      }
    },
    [activeBoard, onStatusChange, pushToast, sessionId]
  );

  const resetBoards = useCallback(() => {
    setBoards([]);
    setActiveBoardId("");
    setActiveShareToken(null);
    setActivePermission("edit");
    setCollaborators([]);
    setCollaboratorActionEmail(null);
  }, []);

  return {
    boards,
    activeBoard,
    activeBoardId,
    activeShareToken,
    activePermission,
    canEditBoard,
    isBoardsLoading,
    isCreatingBoard,
    deletingBoardId,
    collaborators,
    isCollaboratorsLoading,
    collaboratorActionEmail,
    loadBoards,
    loadCollaborators,
    selectBoard,
    handleCreateBoard,
    handleDeleteBoard,
    handleShareBoard,
    handleCopyExistingShareLink,
    handleRevokeShareLink,
    handleGrantAccessByEmail,
    handleUpdateCollaboratorPermission,
    handleRemoveCollaborator,
    resetBoards,
  };
}
