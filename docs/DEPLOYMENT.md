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
| `OPENROUTER_EMBEDDING_MODEL` | No | Defaults to the configured free embedding model. Confirm that the selected model supports the configured dimension. |
| `OPENROUTER_EMBEDDING_DIMENSION` | No | Defaults to `1024`, which must match the PostgreSQL `vector(1024)` contract. |

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

### Frontend build

| Variable | Required | Rule |
| --- | --- | --- |
| `NEXT_PUBLIC_GRAPHQL_ENDPOINT` | Yes | Build-time public URL ending in `/graphql`. Production builds must use the deployed backend and must not use `localhost`. |

Because this variable is embedded in the browser bundle, changing it requires a new frontend build and deployment.

## Production checklist

1. Create separate Neon databases or branches for local, staging, and production.
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

Use GitHub Environments to separate staging and production secrets. Protect `main` so changes require a Pull Request and passing CI checks. OpenRouter smoke tests that contact the real provider should run manually or against staging, not on every Pull Request.

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
- Configure the service health check to use `/healthz` after that endpoint is available.
- Set `NODE_ENV=production`, `PORT`, `FRONTEND_ORIGIN`, and all backend secrets in the Render environment settings.
- Keep the service at one instance until subscription PubSub and maintenance workers are externalized.

### Neon

- Use a production database separate from staging.
- Enable automatic backups and review retention before launch.
- Use a pooled runtime connection only when Prisma is configured for it; use a direct connection for migrations when required by the provider.

## Failure behavior

- If OpenRouter is unavailable, notes remain writable and are marked as pending for later indexing.
- If Resend is unavailable, account actions that require email report an operational failure; credentials must not be logged.
- If Upstash is unavailable, authentication rate-limited routes fail closed rather than silently falling back to an in-memory limiter in production.
- If PostgreSQL is unavailable, the backend must fail readiness checks and the hosting platform should keep it out of service.
