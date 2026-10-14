# Synapse Workspace

Collaborative notes workspace with shared boards, real-time updates, and semantic search powered by PostgreSQL and pgvector.

Synapse helps people keep technical notes in shared boards and find them by meaning as well as by exact wording. Write in the workspace, let autosave persist changes, and retrieve relevant notes with semantic search.

![Synapse Workspace with a saved note in a temporary guest workspace](docs/workspace.png)

The app includes a temporary guest mode for exploring a running instance. This repository does not advertise a hosted demo URL; verify any deployment before sharing it as a live demo.

## Features

- **Notes and boards:** Create boards and write block-based notes with automatic saving.
- **Semantic search:** Search notes by meaning using embeddings stored as `vector(1024)` in PostgreSQL with pgvector.
- **Resilient indexing:** Note writes continue when the embedding provider is unavailable; affected notes are marked pending for reindexing.
- **Sharing and collaboration:** Share boards with view or edit permissions, or manage collaborators by email. The API checks access for each operation.
- **Live updates:** GraphQL subscriptions deliver note updates and deletions to connected clients.
- **MCP integration:** Connect through the backend's remote HTTP MCP endpoint with OAuth 2.1 and PKCE, or use the local stdio server in `mcp/`.
- **Account and guest sessions:** Explore with a temporary guest workspace or use an account for private and shared boards.

## Architecture

| Layer | Implementation |
| --- | --- |
| Frontend | Next.js App Router, React, TypeScript, and BlockNote editor components. |
| API | Node.js, TypeScript, and GraphQL Yoga, organized into resolvers and feature services. |
| Database | PostgreSQL managed through Prisma; pgvector stores 1024-dimensional note embeddings. Parameterized raw Prisma queries handle vector similarity operations. |
| Embeddings | OpenRouter generates embeddings. When indexing fails, notes remain writable and are retried by the backend's reindex worker. |
| Realtime | GraphQL subscriptions publish board-scoped note update and deletion events. |
| MCP | A local stdio server and a remote backend endpoint expose note and board tools to MCP clients. |

The backend keeps subscription PubSub, subscription tickets, and maintenance timers in process memory. Run a single backend replica; see the [operations runbook](docs/OPERATIONS.md) before changing the deployment topology.

## Run locally

### Requirements

- Node.js 20
- pnpm 10.33.0
- Docker with Docker Compose

Install dependencies from the repository root:

```powershell
pnpm install
```

Create `backend/.env` with the local database URL and development mode:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/synapse?schema=public
NODE_ENV=development
```

Create `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_GRAPHQL_ENDPOINT=http://localhost:4000/graphql
SYNAPSE_DEPLOYMENT_ENV=development
```

These are minimal local settings; the tracked environment templates contain type placeholders such as `string` and `number`, which must not be used as literal values. Add `OPENROUTER_API_KEY` to `backend/.env` to enable live embedding requests. Without a working embedding provider, note editing remains available while indexing is pending. See [deployment configuration](docs/DEPLOYMENT.md#local-setup) for the full environment contract.

Start the database, apply migrations, then run the frontend and backend:

```powershell
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000` and choose **Enter Demo Mode** to create a temporary guest workspace. The backend GraphQL API is available at `http://localhost:4000/graphql`; PostgreSQL listens on port `5434`.

## Tests and checks

```powershell
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm test:integration` requires the local database to be running and migrated. `pnpm e2e` runs the Playwright browser suite, applies migrations, and starts a local OpenRouter mock plus the frontend and backend for the test run:

```powershell
pnpm db:up
pnpm e2e
```

For a production build, run `pnpm build`.

## Documentation

- [Architecture and data contract](docs/ARCHITECTURE.md)
- [Deployment and environment configuration](docs/DEPLOYMENT.md)
- [User guide](docs/USER_GUIDE.md)
- [Operations runbook](docs/OPERATIONS.md)
- [Portfolio walkthrough](docs/PORTFOLIO_DEMO.md)
- [MCP setup](MCP_SETUP.md)
- [Smoke tests](scripts/smoke/README.md)
