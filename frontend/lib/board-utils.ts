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
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = `share=${encodeURIComponent(token)}`;
  return url.toString();
}
