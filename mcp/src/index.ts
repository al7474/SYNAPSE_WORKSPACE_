import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const graphqlUrl = process.env.SYNAPSE_API_URL ?? "http://localhost:4000/graphql";
const sessionToken = process.env.SYNAPSE_SESSION_TOKEN;

if (!sessionToken) {
  throw new Error("SYNAPSE_SESSION_TOKEN is required.");
}
const authenticatedSessionToken: string = sessionToken;

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface Board {
  id: string;
  name: string;
  sharePermission: string;
  updatedAt: string;
}

interface Note {
  id: string;
  boardId: string;
  title: string;
  content: string;
  embeddingPending: boolean;
  createdAt: string;
  updatedAt: string;
}

async function requestGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `synapse_auth_session=${encodeURIComponent(authenticatedSessionToken)}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Synapse API returned HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as GraphqlResponse<T>;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  if (!payload.data) {
    throw new Error("Synapse API returned no data.");
  }

  return payload.data;
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({
  name: "synapse",
  version: "0.1.0",
});

server.registerTool(
  "list_boards",
  {
    description: "List the authenticated user's Synapse boards.",
    inputSchema: {},
  },
  async () => {
    const result = await requestGraphql<{ listBoards: Board[] }>(`
      query ListBoards {
        listBoards { id name sharePermission updatedAt }
      }
    `, {});
    return textResult(result.listBoards);
  }
);

server.registerTool(
  "create_board",
  {
    description: "Create a new Synapse board. Ask the user for confirmation before calling.",
    inputSchema: {
      name: z.string().min(1).max(500),
    },
  },
  async ({ name }) => {
    const result = await requestGraphql<{ createBoard: Board }>(`
      mutation CreateBoard($name: String!) {
        createBoard(name: $name) {
          id name sharePermission updatedAt
        }
      }
    `, { name });
    return textResult(result.createBoard);
  }
);

server.registerTool(
  "list_notes",
  {
    description: "List all notes in a Synapse board.",
    inputSchema: { boardId: z.string().min(1) },
  },
  async ({ boardId }) => {
    const result = await requestGraphql<{ listNotes: Note[] }>(`
      query ListNotes($boardId: ID!) {
        listNotes(boardId: $boardId) {
          id boardId title content embeddingPending createdAt updatedAt
        }
      }
    `, { boardId });
    return textResult(result.listNotes);
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
    const result = await requestGraphql<{ semanticSearch: Note[] }>(`
      query SearchNotes($boardId: ID!, $query: String!, $limit: Int) {
        semanticSearch(boardId: $boardId, query: $query, limit: $limit) {
          id boardId title content embeddingPending createdAt updatedAt
        }
      }
    `, { boardId, query, limit });
    return textResult(result.semanticSearch);
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
    const result = await requestGraphql<{ createNote: Note }>(`
      mutation CreateNote($boardId: ID!, $title: String!, $content: String!) {
        createNote(boardId: $boardId, title: $title, content: $content) {
          id boardId title content embeddingPending createdAt updatedAt
        }
      }
    `, { boardId, title, content });
    return textResult(result.createNote);
  }
);

server.registerTool(
  "create_task_list",
  {
    description:
      "Create a note containing a checklist of tasks in a Synapse board. Ask the user for confirmation before calling.",
    inputSchema: {
      boardId: z.string().min(1),
      title: z.string().min(1).max(500),
      tasks: z
        .array(
          z.object({
            text: z.string().min(1).max(2000),
            completed: z.boolean().optional(),
          })
        )
        .min(1)
        .max(100),
    },
  },
  async ({ boardId, title, tasks }) => {
    const content = tasks
      .map((task) => `- [${task.completed ? "x" : " "}] ${task.text}`)
      .join("\n");
    const result = await requestGraphql<{ createNote: Note }>(`
      mutation CreateTaskList($boardId: ID!, $title: String!, $content: String!) {
        createNote(boardId: $boardId, title: $title, content: $content) {
          id boardId title content embeddingPending createdAt updatedAt
        }
      }
    `, { boardId, title, content });
    return textResult(result.createNote);
  }
);

server.registerTool(
  "update_note",
  {
    description: "Update the title and/or content of an existing Synapse note. Ask the user for confirmation before calling.",
    inputSchema: {
      boardId: z.string().min(1),
      id: z.string().min(1),
      title: z.string().min(1).max(500).optional(),
      content: z.string().min(1).optional(),
    },
  },
  async ({ boardId, id, title, content }) => {
    if (title === undefined && content === undefined) {
      throw new Error("At least one of title or content is required.");
    }

    const result = await requestGraphql<{ updateNote: Note }>(`
      mutation UpdateNote(
        $boardId: ID!, $id: ID!, $title: String, $content: String
      ) {
        updateNote(boardId: $boardId, id: $id, title: $title, content: $content) {
          id boardId title content embeddingPending createdAt updatedAt
        }
      }
    `, { boardId, id, title, content });
    return textResult(result.updateNote);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
