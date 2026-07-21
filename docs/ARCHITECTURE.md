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
- `frontend/lib/graphql-client.ts`: authenticated GraphQL requests and subscription URL construction.
- `frontend/lib/session.ts`: session identifiers and local storage persistence.
- `frontend/components/auth/`: authentication and session-loading views.
- `frontend/components/workspace/`: workspace shell, navigation, note grid, editor, dialogs, and notifications.
- `frontend/types/workspace.ts`: shared domain contracts for boards, notes, sessions, and toasts.

Keep GraphQL and browser persistence inside hooks or `lib/` modules. Components should receive data and callbacks through typed props, and the page should remain a composition layer rather than a feature implementation.

## Local infrastructure commands

- `pnpm db:up`: start PostgreSQL + pgvector via `compose.yaml`.
- `pnpm db:migrate`: apply backend SQL migrations.
- `pnpm db:down`: stop local database.

## Ownership and route protection

- Every GraphQL request must include `x-session-id`.
- Backend resolvers scope all note operations by `owner_id = sessionId`.
- `noteUpdated` subscription events are filtered by owner before sending.
- Frontend persists a guest session id in local storage and sends it in API and subscription calls.

## Security guardrails

- Only env templates are tracked: `.env.example`, `backend/.env.example`, `frontend/.env.example`.
- `pnpm verify:env-templates`: fails if non-template env files are tracked.
- `pnpm secrets:scan`: scans tracked files for high-risk secret patterns.
- CI workflow runs env-template verification, secret scan, then monorepo build.

## Recommended development order

1. Backend note module (`createNote`, `updateNote`, `listNotes`).
2. Frontend editor shell and autosave integration.
3. Embedding generation and semantic search.
4. Realtime (`noteUpdated`) integration.
