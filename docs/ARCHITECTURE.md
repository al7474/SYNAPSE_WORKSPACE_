# Synapse Monorepo Baseline

## Data contract (frozen)

- Embedding dimension: `2048`
- Notes table: `notes`
- Columns required by contract:
  - `embedding VECTOR(2048)`
  - `embedding_pending BOOLEAN NOT NULL DEFAULT FALSE`
  - `owner_id TEXT NOT NULL`

Reference migration: `backend/db/migrations/0001_create_notes.sql`.

## Monorepo structure

- `backend/`: GraphQL API and service layer.
- `frontend/`: Next.js App Router UI.
- `scripts/smoke/`: infrastructure and resilience smoke tests.

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
