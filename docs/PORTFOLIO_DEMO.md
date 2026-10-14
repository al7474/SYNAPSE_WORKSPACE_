# Synapse Workspace Portfolio Demo

Target duration: **2 minutes 50 seconds**.

The demo is designed to show the product value first and the engineering depth through visible behavior. Keep the browser at desktop width, use a clean guest session, and avoid entering real credentials.

## Product and engineering highlights

Use these examples during the walkthrough or follow-up discussion to show the strongest existing decisions without adding more features:

- **Semantic search and resilient indexing:** Search for a concept after creating a note. Embeddings use the note title and content, are stored in PostgreSQL as `vector(1024)`, and are queried with pgvector. If OpenRouter is unavailable, the note remains writable and is marked for reindexing.
- **Realtime collaboration:** The second-client step demonstrates the GraphQL `noteUpdated` and `noteDeleted` subscriptions, scoped to the active board and revalidated against current access.
- **Board sharing:** Boards support view/edit share links and email collaborators. The backend checks permissions on each operation; this is a useful follow-up demonstration if time allows.
- **MCP integration:** VS Code can connect to the remote `/mcp` endpoint with OAuth 2.1 and PKCE, or use the local stdio server. Both expose tools for listing boards, searching and managing notes; see [MCP setup](../MCP_SETUP.md).
- **Architecture:** The Next.js client talks to a GraphQL Yoga backend, which uses Prisma for PostgreSQL access and parameterized raw queries for pgvector similarity operations. See [the architecture guide](ARCHITECTURE.md).

## Before recording

1. Start PostgreSQL/pgvector and apply migrations:

   ```powershell
   pnpm db:up
   pnpm db:migrate
   ```

2. For a local recording, configure the environment as described in [local deployment setup](DEPLOYMENT.md#local-setup) and start the stack with `pnpm dev`. Use a deployed frontend only after verifying its current URL and the backend `/healthz` and `/readyz` endpoints. This repository does not provide a verified public demo URL.
3. Open a private browser window at the frontend URL.
4. Confirm that the backend is awake and the first board loads.
5. Keep a second browser window ready for the realtime moment.

To verify semantic search deterministically, run the Playwright suite with its local OpenRouter mock:

```powershell
pnpm e2e
```

This command runs tests and exits; it does not leave a local stack running for a recording. For a live local semantic-search demonstration, configure `OPENROUTER_API_KEY` in `backend/.env` and confirm that indexing has completed before searching.

## Timed script

### 0:00-0:15 | Context

> Synapse Workspace is a collaborative second brain for technical notes. It combines fast block-based writing, automatic persistence, semantic retrieval, and live synchronization in a small workspace shell.

Show the authentication screen and point to the demo entry point.

### 0:15-0:35 | Zero-friction onboarding

Click **Enter Demo Mode**.

> A visitor can explore an isolated temporary workspace without creating an account. The session is server-managed and expires, so the portfolio reviewer can get to the product immediately without a signup interruption.

Show the first board and **Create New Note**.

### 0:35-1:05 | Create and autosave

Create a note named **Launch checklist** with content such as `Docker deployment and database migration plan`.

> I can start with a blank note, edit normally, and let autosave persist the work in the background. The `Last saved` state gives immediate feedback without adding a save button to the workflow.

Pause briefly on the saved timestamp.

### 1:05-1:30 | Semantic retrieval

Close the editor and search for `deployment plan`.

> Search is based on the note embedding rather than only a literal title match. The result is ranked as a semantic match, while notes that are still waiting for indexing remain writable.

Show the matching card and clear the search.

### 1:30-2:10 | Two-client realtime

Open the same workspace in the prepared second browser window. In the first client, create or edit a note named **Realtime handoff**.

> Both clients receive the board-scoped event through the GraphQL subscription stream. The second view updates without a refresh, which is the important collaboration moment.

Delete the note in the first client and show it disappearing from the second client.

> Deletions are propagated too, so a connected collaborator does not keep a stale note or selection.

### 2:10-2:35 | Logout and session protection

Click **Log Out**.

> Logout revokes the temporary session and returns the browser to authentication. If the session disappears while the page is open, the same validation path removes access instead of leaving a protected workspace visible.

Optionally reload once to show the authentication screen remains.

### 2:35-2:50 | Closing statement

> The result is a focused workspace that is easy to try, reliable while writing, useful when the note collection grows, and honest about realtime and AI-service failures. The repository backs these flows with Playwright E2E tests, PostgreSQL integration tests, and CI checks.

End on the repository. Include a deployed URL only after verifying that the deployment is active; do not present the local guest flow as a hosted public demo.

## Evidence checklist

- Demo onboarding: `enters Demo Mode and exposes a ready workspace`
- Note persistence: `creates a note and autosaves title and content`
- Semantic retrieval: `returns semantically matching notes for a search query`
- Logout: `logs out and returns to the authentication screen`
- Expiry recovery: `returns to authentication when the session cookie is gone`
- Realtime update: `delivers note updates to a second connected client`
- Realtime deletion: `delivers note deletion to a second connected client`

The full browser command is:

```powershell
pnpm e2e
```
