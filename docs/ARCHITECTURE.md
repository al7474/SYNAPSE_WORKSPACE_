# Synapse Monorepo Baseline

## Data contract (frozen)

- Embedding dimension: `1024`
- Notes table: `notes`
- Columns required by contract:
  - `embedding VECTOR(1024)`
  - `embedding_pending BOOLEAN NOT NULL DEFAULT FALSE`
  - `owner_id TEXT NOT NULL`

Reference migration: `backend/db/migrations/0005_align_embedding_dimension_to_1024.sql`.

## Monorepo structure

- `backend/`: GraphQL API and service layer.
- `frontend/`: Next.js App Router UI.
- `scripts/smoke/`: infrastructure and resilience smoke tests.

## Frontend module boundaries

- `frontend/app/page.tsx`: composition root. It selects the loading, authentication, or workspace experience and wires hooks to components.
- `frontend/hooks/use-auth-session.ts`: browser session hydration, guest access, sign-in, registration, and logout state.
- `frontend/hooks/use-boards.ts`: board loading, selection, permissions, sharing, deletion, and collaborator actions.
- `frontend/hooks/use-notes.ts`: note loading, selection, autosave, semantic search, realtime updates, creation, and deletion.
- `frontend/hooks/use-toasts.ts`: transient notification state and cleanup.
- `frontend/lib/graphql-client.ts`: cookie-authenticated GraphQL requests and subscription URL construction.
- `frontend/lib/session.ts`: guest and account session API calls; account identity is never persisted in local storage.
- `frontend/components/auth/`: authentication and session-loading views.
- `frontend/components/workspace/`: workspace shell, navigation, note grid, editor, dialogs, and notifications.
- `frontend/types/workspace.ts`: shared domain contracts for boards, notes, sessions, and toasts.

Keep GraphQL and browser persistence inside hooks or `lib/` modules. Components should receive data and callbacks through typed props, and the page should remain a composition layer rather than a feature implementation.

## Local infrastructure commands

- `pnpm db:up`: start PostgreSQL + pgvector via `compose.yaml`.
- `pnpm db:migrate`: apply backend SQL migrations.
- `pnpm db:down`: stop local database.
- `pnpm smoke:auth`: exercise the HTTP account session flow.
- `pnpm smoke:auth:tokens`: exercise bcrypt and one-time token lifecycle rules.

## Ownership and route protection

- Demo sessions are created by the backend and identified by an opaque `HttpOnly` cookie.
- The backend resolves the demo owner from `guest_sessions` before GraphQL operations run.
- Account sessions are created by the backend, stored as SHA-256 token hashes, and identified by a separate opaque `HttpOnly` cookie.
- Account passwords are stored with bcrypt; raw passwords and session tokens are never stored in PostgreSQL.
- Account email verification and password recovery use expiring, single-use action tokens whose hashes are stored in PostgreSQL.
- Backend resolvers use typed ownership (`owner_kind` plus `owner_user_id` or `owner_guest_session_id`) for account and guest authorization. The textual `owner_id` remains a compatibility field.

### Board sharing and authorization

- Every board and note resolver requires a validated account or guest session and checks ownership, collaborator permission, or share-link permission in the backend.
- Collaborator email authorization uses the authenticated account email resolved into the GraphQL context; browser-provided identity headers are not trusted.
- Share links use 32 cryptographically random bytes (256 bits), encoded as base64url. PostgreSQL stores only the SHA-256 token hash in `share_token_hash`.
- The raw token is returned only by `createShareLink`. Generating a new link replaces the stored hash and invalidates the previous link. Owners can revoke a link, which clears the hash.
- Share links support `view` and `edit`. Read operations accept either permission; note writes require `edit` and are checked again for every request.
- Browser share URLs place the token in the URL fragment (`#share=...`) rather than the query string. The frontend removes the consumed fragment after successful access and keeps raw tokens out of ordinary board payloads and persistent browser history where possible.
- Realtime subscriptions revalidate the session and board permission before opening and before delivering each matching event. Revoking a session or share link therefore stops future events on an existing subscription.

## Security guardrails

### Email delivery

- `AUTH_EMAIL_PROVIDER=console` is the local-development default. It logs verification and password-reset links without contacting an external service.
- Production should use `AUTH_EMAIL_PROVIDER=resend` with `RESEND_API_KEY` and a verified `AUTH_EMAIL_FROM` sender.
- Resend or SMTP is only the delivery transport. Token generation, hashing, expiry, single-use consumption, password hashing, and session revocation remain backend responsibilities.

- Only env templates are tracked: `.env.example`, `backend/.env.example`, `frontend/.env.example`.
- `pnpm verify:env-templates`: fails if non-template env files are tracked.
- `pnpm secrets:scan`: scans tracked files for high-risk secret patterns.
- CI workflow runs env-template verification, secret scan, then monorepo build.

## Recommended development order

1. Backend note module (`createNote`, `updateNote`, `listNotes`).
2. Frontend editor shell and autosave integration.
3. Embedding generation and semantic search.
4. Realtime (`noteUpdated`) integration.
