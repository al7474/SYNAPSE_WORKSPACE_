# Synapse Workspace Portfolio Demo

Target duration: **2 minutes 50 seconds**.

The demo is designed to show the product value first and the engineering depth through visible behavior. Keep the browser at desktop width, use a clean guest session, and avoid entering real credentials.

## Before recording

1. Start PostgreSQL/pgvector and apply migrations:

   ```powershell
   pnpm db:up
   pnpm db:migrate
   ```

2. Start the local stack with `pnpm dev`, or open the deployed frontend after checking `/healthz` and `/readyz`.
3. Open a private browser window at the frontend URL.
4. Confirm that the backend is awake and the first board loads.
5. Keep a second browser window ready for the realtime moment.

For a deterministic local semantic-search recording, run the E2E stack so the local OpenRouter mock is used:

```powershell
pnpm e2e
```

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

End on the repository or deployed URL, not on a setup terminal.

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
