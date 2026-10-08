# Synapse Monorepo Baseline

## Data contract (frozen)

- Embedding dimension: `1024`
- Notes table: `notes`
- Columns required by contract:
  - `embedding VECTOR(1024)`
  - `embedding_pending BOOLEAN NOT NULL DEFAULT FALSE`
  - `owner_id TEXT NOT NULL`

Prisma schema: `backend/prisma/schema.prisma`.

The production migration history lives in `backend/prisma/migrations/`. The initial migration creates
the complete schema, enables `pgvector`, and keeps the `vector(1024)` embedding contract. Prisma Client
handles normal database access; parameterized raw Prisma queries are reserved for pgvector writes and
similarity search because Prisma cannot expose `Unsupported("vector(1024)")` fields in the generated API.

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
- `pnpm db:migrate`: apply committed Prisma migrations with `prisma migrate deploy`.
- `pnpm db:migrate:dev`: create/apply a development migration after changing `schema.prisma`.
- `pnpm db:reset`: reset the local database, apply Prisma migrations, and run the configured seed.
- `pnpm db:seed`: run the Prisma demo seed.
- `pnpm db:down`: stop local database.
- `pnpm smoke:auth`: exercise the HTTP account session flow.
- `pnpm smoke:auth:tokens`: exercise bcrypt and one-time token lifecycle rules.

## Ownership and route protection

- Demo sessions are created by the backend and identified by an opaque `HttpOnly` cookie.
- The backend resolves the demo owner from `guest_sessions` before GraphQL operations run.
- Account sessions are created by the backend, stored as SHA-256 token hashes, and identified by a separate opaque `HttpOnly` cookie.
- Authentication uses revocable, database-backed opaque sessions rather than JWTs. This keeps logout, password-reset invalidation, and account-wide session revocation immediate. Registration does not auto-create a session and always returns a generic response to avoid email enumeration.
- Account passwords are stored with bcrypt; raw passwords and session tokens are never stored in PostgreSQL.
- Account email verification and password recovery use expiring, single-use action tokens whose hashes are stored in PostgreSQL.
- Verification and password-reset links carry their action token only in the URL fragment (`#token=...`), and the frontend removes it before submitting the token to the backend. Query-string tokens are not accepted.
- Unverified account sessions can use private boards, notes, autosave, and search. GraphQL sharing and collaborator-management operations return `EMAIL_VERIFICATION_REQUIRED` until the email is verified. Guest sessions are unaffected by account verification.
- Backend resolvers use typed ownership (`owner_kind` plus `owner_user_id` or `owner_guest_session_id`) for account and guest authorization. The textual `owner_id` remains a compatibility field.

### Board sharing and authorization

- Every board and note resolver requires a validated account or guest session and checks ownership, collaborator permission, or share-link permission in the backend.
- Collaborator email authorization uses the authenticated account email resolved into the GraphQL context only when that email is verified; unverified accounts never match board invitations by email. Browser-provided identity headers are not trusted.
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

### HTTP authentication controls

- Authentication, guest-session, and GraphQL mutation requests require the double-submit CSRF token from `GET /auth/csrf` in the `X-CSRF-Token` header and `synapse_csrf_token` cookie. The CSRF cookie is intentionally readable by the frontend; the account and guest session cookies remain `HttpOnly`.
- Mutating requests are checked against `FRONTEND_ORIGIN` in production, and authentication responses use `no-store` plus restrictive security headers. Configure `TRUST_PROXY=true` only when a trusted reverse proxy overwrites `X-Forwarded-For`.
- Registration, login, guest-session creation, and email/password actions are rate limited. Local development uses the bounded in-memory adapter; production uses the atomic Upstash Redis adapter configured through `AUTH_RATE_LIMIT_STORE=upstash`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN`.
- Authentication request bodies are capped by `AUTH_BODY_MAX_BYTES` (16 KiB by default). Production deployments must use HTTPS origins and a real email provider.

- Only env templates are tracked: `.env.example`, `backend/.env.example`, `frontend/.env.example`.
- `pnpm verify:env-templates`: fails if non-template env files are tracked.
- `pnpm secrets:scan`: scans tracked files for high-risk secret patterns.
- CI workflow runs env-template verification, secret scan, then monorepo build.

## Recommended development order

1. Backend note module (`createNote`, `updateNote`, `listNotes`).
2. Frontend editor shell and autosave integration.
3. Embedding generation and semantic search.
4. Realtime (`noteUpdated`) integration.
