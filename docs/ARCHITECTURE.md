# Synapse Monorepo Baseline

## Data contract (frozen)

- Embedding dimension: `2048`
- Notes table: `notes`
- Columns required by contract:
  - `embedding VECTOR(2048)`
  - `embedding_pending BOOLEAN NOT NULL DEFAULT FALSE`

Reference migration: `backend/db/migrations/0001_create_notes.sql`.

## Monorepo structure

- `backend/`: GraphQL API and service layer.
- `frontend/`: Next.js App Router UI.
- `scripts/smoke/`: infrastructure and resilience smoke tests.

## Local infrastructure commands

- `pnpm db:up`: start PostgreSQL + pgvector via `compose.yaml`.
- `pnpm db:migrate`: apply backend SQL migrations.
- `pnpm db:down`: stop local database.

## Recommended development order

1. Backend note module (`createNote`, `updateNote`, `listNotes`).
2. Frontend editor shell and autosave integration.
3. Embedding generation and semantic search.
4. Realtime (`noteUpdated`) integration.
