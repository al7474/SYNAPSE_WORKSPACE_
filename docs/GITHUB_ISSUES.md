# UCD Issue Backlog

This document contains issue-ready bodies for the core user-centered flows in Synapse Workspace. Copy each section into a GitHub Issue and apply the suggested labels. The acceptance criteria are intentionally testable and map to the Playwright scenarios in `e2e/workspace.spec.ts`.

Remote issue creation requires an authenticated GitHub account. This repository does not create issues automatically from CI.

## Issue 1: Make Demo Mode a frictionless first-run path

**Suggested labels:** `ux`, `onboarding`, `e2e`

### User story

As a portfolio visitor, I want to enter an isolated workspace without creating an account so that I can understand the product before committing to registration.

### Primary flow

1. Open the application while unauthenticated.
2. Select **Enter Demo Mode**.
3. Wait for the temporary workspace and first board to load.
4. Confirm that the workspace can be explored without account credentials.
5. Optionally delete the demo workspace before leaving.

### Acceptance criteria

- [ ] The unauthenticated screen exposes one clear `Enter Demo Mode` action.
- [ ] A successful action creates an isolated guest session and shows the workspace shell.
- [ ] The workspace exposes a board and a `Create New Note` action after loading.
- [ ] Loading and authentication failures show a recoverable status or error message.
- [ ] The demo workspace can be deleted and its guest session is revoked.
- [ ] The flow does not require an email, password, or external provider.

### Test mapping

- `enters Demo Mode and exposes a ready workspace`

## Issue 2: Create notes and make autosave trustworthy

**Suggested labels:** `core-workflow`, `editor`, `e2e`

### User story

As a knowledge worker, I want a new note to save automatically while I edit it so that I can focus on thinking instead of managing persistence.

### Primary flow

1. Enter Demo Mode.
2. Select **Create New Note**.
3. Replace the title and description.
4. Wait for the saved timestamp.
5. Reload or revisit the board and confirm the content remains available.

### Acceptance criteria

- [ ] Creating a note opens the editor with a stable note identity.
- [ ] The title and description fields are editable when the board is writable.
- [ ] The UI exposes an autosave state while a change is pending.
- [ ] The UI exposes a `Last saved` timestamp after the mutation succeeds.
- [ ] A failed save leaves the draft visible and reports a recoverable error.
- [ ] Saved content is returned by the notes query after navigation or reload.
- [ ] Read-only users cannot edit or delete the note.

### Test mapping

- `creates a note and autosaves title and content`
- Realtime coverage also verifies that an update reaches a connected client.

## Issue 3: Make semantic search explainable and resilient

**Suggested labels:** `search`, `ai`, `e2e`

### User story

As a user with many notes, I want to search by meaning so that I can find relevant knowledge even when my query does not exactly match the note title.

### Primary flow

1. Create and save a note with meaningful content.
2. Return to the board.
3. Enter a query of at least three characters in the search field.
4. Wait for semantic results.
5. Clear the query to return to the latest notes.

### Acceptance criteria

- [ ] Queries shorter than three characters do not trigger an expensive semantic search.
- [ ] Search is debounced and exposes a running or completed status.
- [ ] Matching notes show semantic results and scores when available.
- [ ] An empty result set is distinguishable from a loading state.
- [ ] A failed embedding/search request leaves the workspace usable and reports an error.
- [ ] Notes saved while embeddings are unavailable remain writable and show pending indexing.
- [ ] Pull requests use the local embedding mock rather than a real provider key.

### Test mapping

- `returns semantically matching notes for a search query`
- Backend integration coverage verifies mocked embeddings and pending-index fallback.

## Issue 4: Make logout and expired sessions predictable

**Suggested labels:** `security`, `auth`, `e2e`

### User story

As a user, I want logout and session expiry to remove access cleanly so that a shared or unattended browser cannot keep using my workspace.

### Primary flow: logout

1. Enter Demo Mode.
2. Select **Log Out**.
3. Confirm that the authentication screen returns.
4. Confirm that protected workspace controls are no longer present.

### Primary flow: expiry

1. Enter Demo Mode.
2. Remove the session cookie or allow the session to expire.
3. Reload or focus the page.
4. Confirm that the application returns to authentication and does not expose protected notes.

### Acceptance criteria

- [ ] Logout revokes the active guest or account session on the backend.
- [ ] Logout clears local legacy session state and returns to authentication.
- [ ] A missing or expired session cannot load boards or notes.
- [ ] The UI returns to authentication after session validation detects expiry.
- [ ] The user receives a clear, non-sensitive expiry message when validation runs.
- [ ] Realtime subscriptions close when the session or board is cleared.

### Test mapping

- `logs out and returns to the authentication screen`
- `returns to authentication when the session cookie is gone`

## Issue 5: Keep connected clients synchronized, including deletion

**Suggested labels:** `realtime`, `collaboration`, `e2e`

### User story

As a collaborator, I want edits and deletions to appear in another connected client so that both views represent the same board without manual refreshes.

### Primary flow

1. Authenticate client A and client B to the same board.
2. Keep both boards open.
3. Create or edit a note in client A.
4. Confirm the note appears or changes in client B.
5. Delete the note in client A.
6. Confirm that client B removes the note and does not keep a stale selection.

### Acceptance criteria

- [ ] Note creation and update mutations publish a board-scoped realtime event.
- [ ] Connected clients consume GraphQL Yoga SSE `next` events.
- [ ] A client updates an existing note rather than creating a duplicate.
- [ ] A deleted note disappears from notes and semantic results in connected clients.
- [ ] A deleted selected note clears or moves the editor selection safely.
- [ ] Subscription authorization is revalidated for every delivered event.
- [ ] Events from another board are ignored.
- [ ] Realtime connection errors do not crash the editor and are surfaced to the user.

### Test mapping

- `delivers note updates to a second connected client`
- `delivers note deletion to a second connected client`
- `noteUpdated` smoke coverage remains available for the backend event path.

## Issue 6: Keep the portfolio demonstration under three minutes

**Suggested labels:** `portfolio`, `release`, `documentation`

### User story

As a reviewer evaluating Synapse Workspace, I want a short, repeatable demonstration that shows the product value and engineering depth without setup interruptions.

### Acceptance criteria

- [ ] The complete spoken demo stays below three minutes.
- [ ] The demo shows guest onboarding, note creation, autosave, semantic search, realtime collaboration, and logout/security.
- [ ] The presenter has a clean local or deployed environment prepared before recording.
- [ ] The presenter can recover from a cold backend start without exposing credentials.
- [ ] The demo points to the corresponding E2E evidence and deployment documentation.
- [ ] The script in `docs/PORTFOLIO_DEMO.md` remains synchronized with the current UI labels.

### Test mapping

- All scenarios in `e2e/workspace.spec.ts`
- `docs/PORTFOLIO_DEMO.md`
- `docs/DEPLOYMENT.md`
