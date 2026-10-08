# Deployment Configuration

This document defines the environment contract for Synapse Workspace. It is intentionally sized for a portfolio deployment: one persistent backend instance, one managed PostgreSQL database, and managed services for Redis, email, and embeddings.

## Recommended topology

- Frontend: Vercel running the Next.js application.
- Backend: Render Web Service or another persistent Node.js host.
- Database: Neon PostgreSQL with the `vector` extension enabled.
- Rate limiting: Upstash Redis.
- Transactional email: Resend.
- Embeddings: OpenRouter.

The backend currently keeps GraphQL subscription PubSub and maintenance timers in process memory. Run one backend replica until those responsibilities are moved to shared infrastructure.

## Local setup

Create local files from the tracked templates:

```powershell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
```

Use `NODE_ENV=development` locally. Start the database and apply migrations:

```powershell
pnpm db:up
pnpm db:migrate
pnpm dev
```

The local defaults use:

- Frontend: `http://localhost:3000`
- Backend GraphQL: `http://localhost:4000/graphql`
- PostgreSQL with pgvector: `localhost:5434`
- Console email delivery: no external email provider is contacted.
- In-memory rate limiting: no Upstash account is needed locally.

Never place real API keys, database passwords, session tokens, or Resend credentials in a tracked `.env.example` file.

## Environment variables

### Backend runtime

| Variable | Required | Production rule |
| --- | --- | --- |
| `NODE_ENV` | Yes | Must be exactly `production`. Local development uses `development`. |
| `DATABASE_URL` | Yes | Use the managed PostgreSQL connection string. Keep migration credentials separate when the provider uses a pooler. |
| `PORT` | No | The hosting provider may inject this value. Defaults to `4000`. |
| `FRONTEND_ORIGIN` | Yes in production | Exact browser origin, for example `https://app.example.com`. Do not include a path, query, hash, or trailing slash. HTTPS is required in production. |
| `AUTH_PUBLIC_URL` | Yes in production | Public backend origin, for example `https://api.example.com`. HTTPS is required. |
| `AUTH_FRONTEND_URL` | Yes in production | Frontend origin used in verification and reset links. It must match `FRONTEND_ORIGIN`. |

### Embeddings

| Variable | Required | Production rule |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Yes in production | Store only as a hosting secret. The backend preserves note writes if the provider fails, but the key must exist for indexing to work. |
| `OPENROUTER_API_URL` | No | Defaults to the official OpenRouter embeddings endpoint. HTTP is allowed only for a local development/test host; production requires HTTPS. |
| `OPENROUTER_EMBEDDING_MODEL` | No | Defaults to the configured free embedding model. Confirm that the selected model supports the configured dimension. |
| `OPENROUTER_EMBEDDING_DIMENSION` | No | Defaults to `1024`, which must match the PostgreSQL `vector(1024)` contract. |
| `PENDING_EMBEDDING_ALERT_THRESHOLD` | No | Emits an operational alert when the pending index backlog reaches this count. Defaults to `50`. |

### Observability

| Variable | Required | Production rule |
| --- | --- | --- |
| `SENTRY_DSN` | No | Enables backend error reporting. Keep the DSN in the hosting secret store even though it is not an authentication token. |
| `SENTRY_ENVIRONMENT` | No | Defaults to `NODE_ENV`; use `production` for the deployed backend. |
| `SENTRY_RELEASE` | No | Set to the deployed commit SHA so errors can be tied to a release. |

### Authentication, email, and rate limiting

| Variable | Required | Production rule |
| --- | --- | --- |
| `AUTH_EMAIL_PROVIDER` | Yes in production | Must be `resend`. `console` is local-only. |
| `AUTH_EMAIL_FROM` | Yes with Resend | Use a sender address or display name with an address from a domain verified in Resend. Do not use `example.com` or `tu-dominio.com`. |
| `RESEND_API_KEY` | Yes with Resend | Store only as a hosting secret. |
| `AUTH_RATE_LIMIT_ENABLED` | Yes in production | Must be `true`. |
| `AUTH_RATE_LIMIT_STORE` | Yes in production | Must be `upstash`. |
| `UPSTASH_REDIS_REST_URL` | Yes with Upstash | Must be an HTTPS Upstash REST URL in production. |
| `UPSTASH_REDIS_REST_TOKEN` | Yes with Upstash | Store only as a hosting secret. |
| `AUTH_RATE_LIMIT_MAX_KEYS` | No | Maximum in-memory key count used by the local adapter. Defaults to `10000`. |
| `AUTH_BODY_MAX_BYTES` | No | Maximum authentication request body size. Defaults to `16384`. |
| `AUTH_CSRF_ENABLED` | Yes in production | Must be `true`. The frontend obtains the CSRF token from `GET /auth/csrf` and sends it in `X-CSRF-Token`. |
| `TRUST_PROXY` | Yes in production | Must be `true` only when the hosting provider overwrites forwarding headers through a trusted proxy. |

### Runtime maintenance

These values have safe defaults and can be tuned by the hosting provider:

- `PENDING_REINDEX_INTERVAL_MS`
- `PENDING_REINDEX_BATCH_SIZE`
- `GUEST_SESSION_TTL_MS`
- `GUEST_SESSION_CLEANUP_INTERVAL_MS`
- `AUTH_SESSION_TTL_MS`
- `AUTH_ACTION_TOKEN_TTL_MS`
- `AUTH_CLEANUP_INTERVAL_MS`
- `AUTH_BCRYPT_COST`

Do not disable cleanup or reindexing in production without documenting the operational replacement.

### Remote MCP (OAuth)

The backend exposes a remote Model Context Protocol endpoint at `POST /mcp`
for VS Code (and other MCP clients), protected by an OAuth 2.1 Authorization
Code + PKCE flow that the backend itself implements — Synapse is both the
authorization server and the resource server, so no external identity
provider or additional secret is required. See [MCP_SETUP.md](../MCP_SETUP.md)
for the end-user flow.

| Variable | Required | Production rule |
| --- | --- | --- |
| `MCP_ENABLED` | No | Defaults to `true`. Set to `false` to disable `/mcp`, `/oauth/*`, and the `/.well-known/oauth-*` discovery routes entirely. |
| `MCP_AUTH_CODE_TTL_MS` | No | Authorization code lifetime. Defaults to `300000` (5 minutes); codes are single-use regardless of this value. |
| `MCP_ACCESS_TOKEN_TTL_MS` | No | Bearer access token lifetime. Defaults to `3600000` (1 hour). |
| `MCP_REFRESH_TOKEN_TTL_MS` | No | Refresh token lifetime. Defaults to `2592000000` (30 days). Refreshing rotates both tokens. |

`AUTH_PUBLIC_URL` doubles as the OAuth issuer and the resource identifier
(`AUTH_PUBLIC_URL/mcp`); it must be the exact public HTTPS origin in
production, matching the existing production rule above. No additional CORS
configuration is needed for `/mcp` or `/oauth/*`: MCP clients call the backend
directly (not through a browser `fetch`), and the interactive login page at
`GET /oauth/authorize` is a normal top-level browser navigation, not a
cross-origin request. The login form never sets or reads a cookie; it checks
the submitted email/password with the same `AuthService.login` used by
`POST /auth/login` and issues a one-time authorization code instead.

Changing or resetting a Synapse account's password immediately revokes every
MCP access and refresh token issued for that account, in addition to the
existing browser session revocation.

**Known limitation:** dynamic client registration (`POST /oauth/register`) is
intentionally unauthenticated and open, matching the MCP/VS Code client
discovery flow and RFC 7591's public-client model — anyone can register a
`client_id`, but a registered client can still only mint tokens for a Synapse
user who explicitly signs in and approves that specific authorization
request, scoped to the four read/write scopes, and every access remains
subject to the normal board ownership/collaborator checks. There is currently
no admin UI to list or revoke registered clients or issued tokens outside of
`POST /oauth/revoke` and a password change; treat this the same as any other
early-stage OAuth deployment and monitor `mcp_access_tokens` /
`mcp_refresh_tokens` growth alongside the existing cleanup interval
(`AUTH_CLEANUP_INTERVAL_MS`, which also purges expired MCP codes/tokens).

### Frontend build

| Variable | Required | Rule |
| --- | --- | --- |
| `NEXT_PUBLIC_GRAPHQL_ENDPOINT` | Yes | Build-time public URL ending in `/graphql`. Production builds must use the deployed backend and must not use `localhost`. |
| `SYNAPSE_DEPLOYMENT_ENV` | No | Set to `production` for non-Vercel production builds. Vercel uses `VERCEL_ENV` automatically. Local builds use `development`. |

Because this variable is embedded in the browser bundle, changing it requires a new frontend build and deployment.

## Production checklist

1. Create one production Neon database; use the local Docker database for development and CI's ephemeral PostgreSQL service for pre-release checks.
2. Enable `pgvector` and confirm that the committed Prisma migration applies successfully.
3. Configure the backend environment with `NODE_ENV=production` and all required production variables.
4. Configure the frontend build with `NEXT_PUBLIC_GRAPHQL_ENDPOINT=https://api.example.com/graphql`.
5. Configure `FRONTEND_ORIGIN` and `AUTH_FRONTEND_URL` to the exact frontend origin.
6. Configure `AUTH_PUBLIC_URL` to the exact public backend origin.
7. Verify the sender domain in Resend and set `AUTH_EMAIL_PROVIDER=resend`.
8. Configure Upstash and set `AUTH_RATE_LIMIT_STORE=upstash`.
9. Set `AUTH_CSRF_ENABLED=true` and configure `TRUST_PROXY` according to the hosting proxy.
10. Store all secrets in Vercel, Render, Neon, Upstash, Resend, or GitHub Environment secrets. Do not commit them.
11. Apply committed migrations with `pnpm --filter @synapse/backend db:migrate`, which runs `prisma migrate deploy`.
12. Do not run `db:migrate:dev`, `db:reset`, or `db:seed` as part of a production release.
13. Run the post-deployment health and smoke checks before sharing the public URL.
14. Configure the minimum operational alerts and backup/rotation procedures in [OPERATIONS.md](OPERATIONS.md).

## GitHub and CI rules

The repository checks these conditions before a build:

```powershell
pnpm verify:env-templates
pnpm secrets:scan
```

The tracked environment files are limited to:

- `.env.example`
- `backend/.env.example`
- `frontend/.env.example`

Use the `production` GitHub Environment for release secrets. The repository-level Dependabot, CodeQL, and branch protection settings are described in [GITHUB_GOVERNANCE.md](GITHUB_GOVERNANCE.md). OpenRouter smoke tests that contact the real provider should run manually, not on every Pull Request; Pull Request integration tests use an injected mock instead.

## Continuous deployment

The tracked [CD workflow](../.github/workflows/cd.yml) starts only after the `CI` workflow completes successfully for a commit on `main`. It records the exact CI commit and checks out that SHA for the migration and smoke-test steps. This deployment uses one protected production environment; CI's ephemeral PostgreSQL, integration, and browser jobs provide the pre-release verification instead of a hosted staging environment.

The release sequence is deliberately ordered:

1. Run CI on the commit, including integration and browser E2E checks against ephemeral PostgreSQL.
2. Wait for the required approval on the `production` GitHub Environment.
3. Apply committed Prisma migrations to the production Neon database with `pnpm --filter @synapse/backend db:migrate:deploy`.
4. Trigger the production backend deployment and wait for `/readyz`.
5. Trigger the production frontend deployment.
6. Run the deployment smoke test against production.

The workflow never calls `db:seed`, `db:migrate:dev`, `db:reset`, or any destructive Prisma command. `MIGRATION_DATABASE_URL` must be the direct migration connection for the environment; keep it separate from a pooled runtime connection when the database provider requires that distinction.

### GitHub Environment contract

Create one GitHub Environment named exactly `production` and configure required reviewers for it. No hosted staging Environment is required for this deployment model.

For each environment, configure these **Variables**:

| Variable | Value |
| --- | --- |
| `BACKEND_URL` | Production backend origin without a path, for example `https://api.example.com`. |
| `FRONTEND_URL` | Production frontend origin without a path, for example `https://app.example.com`. |

Configure these **Secrets**:

| Secret | Value |
| --- | --- |
| `MIGRATION_DATABASE_URL` | Direct PostgreSQL connection used only by the migration job. |
| `BACKEND_DEPLOY_HOOK` | Provider hook that deploys the backend `main` service. |
| `FRONTEND_DEPLOY_HOOK` | Provider hook that deploys the frontend `main` service. |
| `MIGRATION_ALERT_WEBHOOK` | Optional failure notification endpoint. The workflow sends only the environment, event name, and release SHA. |

Configure both hooks to deploy from `main`, and disable independent provider deployments for that branch. The workflow sends the validated release SHA in `X-Synapse-Release-SHA`; provider hooks that support commit pinning should use it. If a provider hook deploys the branch tip instead, keep the `cd-main` concurrency group and do not merge another commit while a release is running.

Render is configured with `autoDeploy: false` in [render.yaml](../render.yaml), so a push cannot activate a backend version before CI, migrations, and the release hook. Apply the same policy to the Vercel project: use the frontend hook for the environment or disable automatic production deploys from the Git integration.

### Smoke coverage

The workflow runs `node scripts/smoke/deployment-smoke.mjs`, which is also available locally as `pnpm smoke:deployment`. It verifies:

- `GET /healthz` returns `200` and `{ "status": "ok" }`;
- `GET /readyz` returns `200` and `{ "status": "ready" }`;
- the GraphQL CORS preflight allows the configured frontend origin, credentials, `Content-Type`, and `X-CSRF-Token`;
- `GET /auth/csrf` returns a token and sets the CSRF cookie;
- a mutation without the CSRF header is rejected with `403`;
- a read-only GraphQL request succeeds with no errors.

The smoke does not create an account, session, board, or note. It requires `SMOKE_BASE_URL` and `SMOKE_FRONTEND_ORIGIN`, both as origins without a path.

### Owner kind data plan

Migration `20261008215511_require_explicit_owner_kind` retires the implicit `ownerKind = 'legacy'` default on `boards` and `notes` and makes `ownerMetadata` mandatory in `NotesService`, so every write must state its owner kind explicitly.

Data inventory, checked on 2026-10-08 with read-only queries:

- Local database: 0 `legacy` boards and 0 `legacy` notes.
- Production (Neon): 4 `user` boards and 15 `user` notes. 0 `legacy` boards or notes, 0 `legacy` boards with notes, 0 `legacy` boards with share links, and 0 collaborators on `legacy` boards.

What the migration does:

1. A guard block counts rows in `boards` and `notes` with `owner_kind = 'legacy'`. If the count is above zero, it raises an exception and the migration stops before changing any column.
2. Otherwise it drops the `owner_kind` default on both tables. This is a catalog-only change; it does not rewrite the tables and does not delete, update, or reassign rows.

Compatibility: the previous backend always sends `owner_kind` on insert, so dropping the default does not affect the release window.

If the guard fires during CD, the release stops at the migration step. Inspect the rows with a read-only query, decide for each owner whether to export or delete them, apply that decision through the provider's reviewed backup procedure, and rerun the failed workflow. Do not use `migrate reset` for this.

### Rollback

The CD workflow does not automatically run database down migrations. Prisma migrations are expected to be additive and backward-compatible during the release window; an automatic schema rollback can destroy data or leave the previous application binary incompatible.

If the production smoke fails:

1. Stop the release before sharing the public URL if the failure occurs before activation.
2. Record the failed release SHA and the last successful backend/frontend versions from the provider dashboards.
3. Redeploy the previous known-good backend version and frontend version through Render and Vercel, keeping the database at its current forward-compatible schema.
4. Re-run the deployment smoke with the production URLs.
5. If the migration is not backward-compatible, follow the database provider's reviewed backup/restore procedure; do not improvise a destructive `migrate reset` or an unreviewed SQL reversal.

For a later retry, rerun the failed CD workflow only after the provider state and database schema have been checked. A rollback is an application-version rollback unless a separately reviewed database recovery plan explicitly says otherwise.

## Hosting notes

## Health endpoints

The backend exposes two unauthenticated operational endpoints:

- `GET /healthz` returns `200` with `{ "status": "ok" }` when the Node.js process is alive.
- `GET /readyz` returns `200` with `{ "status": "ready" }` when PostgreSQL responds to a lightweight query. It returns `503` with `{ "status": "not_ready" }` when the database is unavailable.

Configure the hosting provider's health check to use `/healthz`. Use `/readyz` for deployment verification and monitoring because it includes database readiness.

### Vercel

- Set `NEXT_PUBLIC_GRAPHQL_ENDPOINT` separately for Preview and Production.
- Use the public backend URL, not an internal Render hostname, in the browser bundle.
- A frontend preview should use a matching backend CORS origin if authentication is tested there.

### Render

- Run the backend as a persistent Web Service, not a short-lived serverless function.
- Use the repository `render.yaml` Blueprint or configure the Docker service manually.
- Keep automatic deploys disabled and let `.github/workflows/cd.yml` call the protected deploy hook after migrations.
- Configure the service health check to use `/healthz`.
- Set `NODE_ENV=production`, `PORT`, `FRONTEND_ORIGIN`, and all backend secrets in the Render environment settings.
- Keep the service at one instance until subscription PubSub and maintenance workers are externalized.

### Docker

The root `Dockerfile` uses a multi-stage Node 20 build. It installs from `pnpm-lock.yaml`, generates Prisma Client, compiles the backend, and copies only the production backend deployment into the runtime image.

Build and run the image locally with a backend environment file:

```powershell
docker build --tag synapse-backend:local .
docker run --rm --env-file backend/.env -p 4000:4000 synapse-backend:local
```

The container listens on the `PORT` value provided by the environment and exposes `/healthz` for the platform health check. Never copy a real `.env` file into the image or pass secrets through Dockerfile instructions.

### Neon

- Use one production database for the deployed application. The existing Neon staging project may remain as an optional manual sandbox, but it is not part of the release workflow.
- Enable automatic backups and review retention before launch.
- Use a pooled runtime connection only when Prisma is configured for it; use a direct connection for migrations when required by the provider.

## Failure behavior

- If OpenRouter is unavailable, notes remain writable and are marked as pending for later indexing.
- If Resend is unavailable, account actions that require email report an operational failure; credentials must not be logged.
- If Upstash is unavailable, authentication rate-limited routes fail closed rather than silently falling back to an in-memory limiter in production.
- If PostgreSQL is unavailable, the backend must fail readiness checks and the hosting platform should keep it out of service.

Operational alert rules, backup cadence, secret rotation, log retention, and the one-replica constraint are maintained in [OPERATIONS.md](OPERATIONS.md).
