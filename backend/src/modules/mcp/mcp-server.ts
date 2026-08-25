import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NotesService } from "../notes/notes.service.js";
import type { McpAccessTokenContext, McpScope } from "./oauth.types.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function requireScope(context: McpAccessTokenContext, scope: McpScope): void {
  if (!context.scopes.includes(scope)) {
    throw new Error(
      `This access token was not granted the "${scope}" scope. Re-authenticate and approve it to use this tool.`
    );
  }
}

/**
 * Builds a fresh McpServer instance bound to one authenticated Synapse user.
 * Tool handlers delegate directly to `NotesService`, the same service the
 * GraphQL API uses, so board ownership/collaborator permission checks and
 * embedding behavior are not duplicated for the remote MCP transport.
 */
export function createSynapseMcpServer(
  notesService: NotesService,
  tokenContext: McpAccessTokenContext
): McpServer {
  const server = new McpServer({
    name: "synapse",
    version: "0.1.0",
  });

  const ownerId = tokenContext.userId;
  const userEmail = tokenContext.userEmail;
  const ownerMetadata = { ownerKind: "user" as const, ownerUserId: tokenContext.userId };

  server.registerTool(
    "list_boards",
    {
      description: "List the authenticated Synapse user's boards.",
      inputSchema: {},
    },
    async () => {
      requireScope(tokenContext, "boards:read");
      const boards = await notesService.listBoards(ownerId, userEmail, ownerMetadata);
      return textResult(boards);
    }
  );

  server.registerTool(
    "list_notes",
    {
      description: "List all notes in a Synapse board.",
      inputSchema: { boardId: z.string().min(1) },
    },
    async ({ boardId }) => {
      requireScope(tokenContext, "notes:read");
      const notes = await notesService.listNotes({ ownerId, userEmail, ownerMetadata, boardId });
      return textResult(notes);
    }
  );

  server.registerTool(
    "search_notes",
    {
      description: "Search notes semantically within a Synapse board.",
      inputSchema: {
        boardId: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ boardId, query, limit }) => {
      requireScope(tokenContext, "notes:read");
      const notes = await notesService.semanticSearch({
        ownerId,
        userEmail,
        ownerMetadata,
        boardId,
        query,
        limit,
      });
      return textResult(notes);
    }
  );

  server.registerTool(
    "create_note",
    {
      description: "Create a note in a Synapse board. Ask the user for confirmation before calling.",
      inputSchema: {
        boardId: z.string().min(1),
        title: z.string().min(1).max(500),
        content: z.string().min(1),
      },
    },
    async ({ boardId, title, content }) => {
      requireScope(tokenContext, "notes:create");
      const note = await notesService.createNote({
        ownerId,
        userEmail,
        ownerMetadata,
        boardId,
        title,
        content,
      });
      return textResult(note);
    }
  );

  server.registerTool(
    "update_note",
    {
      description:
        "Update the title and/or content of an existing Synapse note. Ask the user for confirmation before calling.",
      inputSchema: {
        boardId: z.string().min(1),
        id: z.string().min(1),
        title: z.string().min(1).max(500).optional(),
        content: z.string().min(1).optional(),
      },
    },
    async ({ boardId, id, title, content }) => {
      requireScope(tokenContext, "notes:update");

      if (title === undefined && content === undefined) {
        throw new Error("At least one of title or content is required.");
      }

      const note = await notesService.updateNote({
        ownerId,
        userEmail,
        ownerMetadata,
        boardId,
        id,
        title,
        content,
      });
      return textResult(note);
    }
  );

  return server;
}
