# Minimal Operations Runbook

This runbook defines the smallest production operating model for Synapse Workspace. It assumes Vercel for the frontend, one Render backend instance, Neon PostgreSQL with `pgvector`, Upstash Redis, Resend, OpenRouter, GitHub Actions, and an optional Sentry project.

## Structured logs

The backend writes one JSON object per log line to stdout or stderr. Request events include:

- `timestamp`, `level`, `service`, and a stable event name;
- `requestId`, HTTP method, pathname without query or fragment, status, duration, and stream state;
- sanitized component context for auth, GraphQL, readiness, maintenance, and embeddings.

The logger never records request headers, cookies, authorization values, passwords, CSRF values, session values, API keys, or raw share tokens. SSE lifecycle events use `shareTokenPresent` and the literal `[REDACTED]` marker. Email links used by the local console provider are also redacted before logging.

Useful event names for provider filters and dashboards:

| Event | Meaning |
| --- | --- |
| `http.request.5xx` | A request ended with a server error. |
| `backend.not_ready` | `/readyz` returned a server error because the database check failed. |
| `sse.subscription.opened`, `sse.subscription.closed` | A realtime stream was opened or closed. |
| `embeddings.pending_backlog` | Pending embedding count crossed the configured threshold. |
| `embeddings.reindex.failed` | The maintenance worker failed while retrying pending embeddings. |
| `auth.cleanup_failed`, `auth.guest_session.cleanup_failed` | Expired-session maintenance failed. |

Keep application log retention short enough for the provider plan, start with 14 days, and restrict log access to the team that operates the service. Never enable a log sink option that captures request headers or full URLs with query strings.

## Sentry and alert rules

Set `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE` in the backend hosting environment. The SDK is disabled when `SENTRY_DSN` is empty. It uses `sendDefaultPii=false` and removes request headers, cookies, query strings, bodies, and sensitive values in `beforeSend`.

Create these minimum alerts:

| Alert | Signal | Initial condition | Response |
| --- | --- | --- | --- |
| HTTP 5xx | Sentry message `http.request.5xx` or provider log event | At least 5 events in 5 minutes, or any sustained 5xx rate above 2% | Inspect the Sentry issue and the deployment SHA; roll back the application version if the error started after release. |
| Backend not ready | Sentry message `backend.not_ready` plus `/readyz` monitor | Any event, or two failed readiness checks in 5 minutes | Check Render instance state and Neon connectivity; keep traffic away until `/readyz` recovers. |
| Migration failure | Failed `Apply production-safe Prisma migrations` step in the `CD` workflow | Any failed staging or production migration job | Do not approve/promote production; inspect the Prisma error and database migration state before retrying. |
| Embedding backlog | Sentry message `embeddings.pending_backlog` | Any event at the configured threshold, default `50` | Check OpenRouter status/key/quota and database connectivity; notes remain writable while indexing is queued. |

Set the optional `MIGRATION_ALERT_WEBHOOK` secret in each GitHub Environment to notify the release team. The migration alert intentionally uses the CD job because migrations run in GitHub Actions before backend activation, not inside the web process. The notification request contains only the environment, `migration.failed`, and release SHA. Its notification step is allowed to fail, but the Prisma migration step is never hidden behind `continue-on-error`.

## Backups and restore checks

- Use separate Neon databases or branches for staging and production.
- Enable Neon automated backups and point-in-time recovery for production; retain at least 7 days for the portfolio deployment and increase retention when the data value requires it.
- Verify that backups include the `notes.embedding` vector column, `embedding_pending`, users, sessions, boards, collaborators, and share-token hashes. A backup must never contain raw session, CSRF, or share tokens because the database stores hashes for those values.
- Take a pre-release backup or confirm a recent recoverable point before a migration that changes data shape.
- Perform a restore drill at least monthly into an isolated database: restore, enable `pgvector`, run `pnpm db:migrate:deploy` only when the target schema is behind, and run readiness/integration checks.
- Record the restore owner, timestamp, recovery point, and observed recovery time. Do not test restores against production.

The release workflow does not run database down migrations automatically. Application rollback assumes additive, backward-compatible migrations; use the provider's reviewed backup/restore procedure for a schema recovery.

## Secret rotation

Rotate production secrets at least every 90 days and immediately after suspected exposure. This includes `DATABASE_URL` credentials, `OPENROUTER_API_KEY`, `RESEND_API_KEY`, Upstash tokens, Render/Vercel deploy hooks, and GitHub Environment secrets. The Sentry DSN is not a credential for reading data, but rotate it if the project or organization policy requires it.

Use this order to avoid downtime:

1. Create the replacement credential with the provider while the old credential remains valid.
2. Store it in the appropriate provider or GitHub Environment secret store; never commit it or place it in a log.
3. Deploy or restart the affected service and verify `/healthz`, `/readyz`, GraphQL, authentication, and the deployment smoke.
4. Revoke the old credential after the new one is confirmed in every environment.
5. Record the rotation date and owner without recording the secret value.

For a leaked session, CSRF, share, or action token, revoke the associated session/share link/action token instead of waiting for scheduled rotation. For a leaked database or provider credential, rotate immediately and review logs for access during the exposure window.

## One-replica limit

Keep the backend at one replica. GraphQL subscriptions use process-local PubSub, and cleanup/reindex workers run in process memory. Multiple replicas would cause:

- realtime updates to reach only clients connected to the publishing process;
- duplicate cleanup and embedding work;
- inconsistent maintenance state and misleading operational counts.

Before scaling horizontally, move PubSub to a shared broker, run cleanup/reindex through a single distributed worker with a lease, and add a shared metrics/alert source. Until then, scale vertically or improve database/provider capacity while preserving one backend instance.