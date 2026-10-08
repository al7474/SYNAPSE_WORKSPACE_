# Synapse Workspace - Copilot Instructions

You are an expert AI pair programmer. Always generate code following these strict guidelines for "SYNAPSE_WORKSPACE" (Collaborative SaaS Note-taking Platform + IA).

## Tech Stack & Architecture
- **Monorepo:** Standard npm/yarn workspaces containing `/backend` and `/frontend`.
- **Backend:** Node.js, TypeScript, modular feature-based architecture (resolvers separated from services).
- **Frontend:** Next.js (App Router), TypeScript, TailwindCSS, shadcn/ui.
- **Database & ORM:** PostgreSQL with `pgvector` extension (Neon in production, local Docker container for development) fully managed via **Prisma ORM** for schema design, migrations, and database queries.
- **Real-time:** GraphQL (Queries, Mutations, Subscriptions).
- **Text Editor:** BlockNote (block-based rich text editor).

## Database, Prisma & Migrations Rules
- **Prisma Schema:** Always define all database entities, relations, enums, and indexes in `/backend/prisma/schema.prisma`.
- **Database Migrations:** Use Prisma CLI (`npx prisma migrate dev --name <migration_name>`) for all database schema changes and version control. Never write raw, unversioned DDL SQL scripts manually unless configuring raw extensions like `pgvector`.
- **Vector Extension Support:** Handle the `pgvector` column using Prisma's `Unsupported("vector(1024)")` type (or matching dimensions of the chosen model) to ensure seamless compatibility with `pgvector` operators (`<=>`).
- **Type Safety & Queries:** Always query the database using the generated `@prisma/client`. Use `$queryRaw` or `$executeRaw` specifically when executing pgvector similarity search queries that require low-level vector operators.
- **Seeding:** Maintain a `prisma/seed.ts` script configured in `package.json` under `"prisma": { "seed": "ts-node prisma/seed.ts" }` to automatically pre-populate the database with demo workspaces and semantically rich sample notes for testing.

## AI, Embeddings & Resilience Rules
- **Primary Model:** Generate embeddings via **OpenRouter API** using a free model (e.g., `nvidia/llama-nemotron-embed-vl-1b-v2:free` or equivalent, using its respective dimensions like 1024).
- **Vector Storage:** Store embeddings in a `vector(1024)` column in PostgreSQL (matching the exact dimension of the chosen OpenRouter model).
- **Resilience Fallback:** If the OpenRouter API fails (due to rate limits, network errors, or downtime), save the note content successfully via Prisma, but set a flag (`embedding_pending = true`) and handle the failure gracefully without crashing the UI. Inform the user that semantic indexing is queued.
- **Semantic Search:** Query Postgres via Prisma raw queries using pgvector's cosine distance operator (`<=>`).
- **Security:** OpenRouter API keys must be loaded securely via backend environment variables (`OPENROUTER_API_KEY`).

## Code Quality & Production-Ready Standards
- **Strict TypeScript:** Never use `any`. Define strict interfaces/types for all payloads, database models, and GraphQL schemas.
- **Async Handling:** Always use `async/await` with clean `try/catch` blocks.
- **Self-Documenting:** Use clean, intent-revealing variable names. Add JSDoc comments only on complex logic.
- **UX & State Management:** Always handle loading, empty, and error states gracefully. 
- **Free-Tier Host Awareness:** Since the backend is hosted on a free-tier server (e.g., Render) that spins down after inactivity, implement elegant frontend loading states ("Initializing secure workspace environment...") to handle cold-starts gracefully.

## UI, UX & Design Consistency
- **Design System:** Always use `shadcn/ui` components located in `@/components/ui/` instead of writing raw HTML elements.
- **Styling:** Rely strictly on Tailwind CSS utility classes and semantic variables (e.g., `bg-background`, `text-foreground`, `bg-primary`, `rounded-md`). Do NOT hardcode hex colors or custom pixel values.
- **Layouts:** Use Next.js layout files for route-level shells (for example `app/layout.tsx`). The workspace is a single route, so `app/page.tsx` stays the composition root that wires hooks to the sidebar, header, and content components, as defined in `docs/ARCHITECTURE.md`.

## Language & Communication
- **Chat Interaction:** The user may prompt you and chat with you in Spanish. You should reply in Spanish during the chat conversation to keep communication comfortable.
- **Code Generation:** Regardless of the chat language, **all generated code, variables, functions, database schemas, API types, and inline comments MUST be strictly in English**. No Spanish words in the codebase.