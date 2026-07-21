import type { Board } from "@/types/workspace";

export function mergeBoards(existingBoards: Board[], incomingBoard: Board): Board[] {
  const index = existingBoards.findIndex((board) => board.id === incomingBoard.id);

  if (index === -1) {
    return [incomingBoard, ...existingBoards];
  }

  const nextBoards = [...existingBoards];
  nextBoards[index] = incomingBoard;
  return nextBoards;
}

export function buildShareLink(token: string): string {
  return `${window.location.origin}${window.location.pathname}?share=${token}`;
}
