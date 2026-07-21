# Smoke Tests (Infra)

This folder centralizes infrastructure smoke tests to keep the project root clean.

## Available tests

- `openrouter-embedding.js`: validates OpenRouter embedding API connectivity.
- `openrouter-pgvector-e2e.js`: validates full flow OpenRouter -> PostgreSQL pgvector.
- `semantic-search-smoke.js`: inserts 3-5 notes with embeddings and validates semantic ranking.
- `resilience-fallback-smoke.js`: simulates OpenRouter failures (invalid key and timeout) and verifies `embedding_pending=true` fallback writes.
- `graphql-base-smoke.js`: validates GraphQL base operations (`createNote`, `updateNote`, `listNotes`).
- `graphql-subscription-noteupdated-smoke.js`: validates GraphQL `noteUpdated` subscription emits ordered events when a note is updated.
- `autosave-realistic-smoke.js`: simulates autosave updates every 2-3 seconds for ~1-2 minutes and validates no duplicates/content loss.

## Environment variables

Required:

- `OPENROUTER_API_KEY`

Optional:

- `DATABASE_URL`
- `OPENROUTER_EMBEDDING_MODEL`
- `OPENROUTER_EMBEDDING_DIMENSION`
- `OPENROUTER_TEST_INPUT`
- `SMOKE_TABLE_NAME`

## pnpm commands

- `pnpm smoke:embedding`
- `pnpm smoke:embedding:db`
- `pnpm smoke:embedding:db:local`
- `pnpm smoke:semantic`
- `pnpm smoke:resilience`
- `pnpm smoke:graphql`
- `pnpm smoke:graphql:subscription`
- `pnpm smoke:autosave`
- `pnpm smoke:foundation:local`
- `pnpm smoke:realtime:local`
- `pnpm smoke:db:up`
- `pnpm smoke:db:down`

## Typical local flow

1. Start temp pgvector DB: `pnpm smoke:db:up`
2. Run end-to-end smoke: `pnpm smoke:embedding:db`
3. Stop and remove DB: `pnpm smoke:db:down`

One-command alternative:

- `pnpm smoke:embedding:db:local` (auto start DB, run test, cleanup)

Foundation one-command suite:

- `pnpm smoke:foundation:local` (auto start DB, run semantic + resilience + GraphQL smokes, cleanup)

Realtime/autosave one-command suite:

- `pnpm smoke:realtime:local` (auto start DB, run subscription + autosave smokes, cleanup)

## Secrets hygiene

- Keep OpenRouter credentials only in `.env`.
- `.gitignore` excludes `.env` and allows only `.env.example`.
- If a key was exposed, rotate it immediately in OpenRouter dashboard and update `.env`.
