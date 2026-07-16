# Synapse Workspace - Copilot Instructions

You are an expert AI pair programmer. Always generate code following these strict guidelines for "SYNAPSE_WORKSPACE" (Collaborative SaaS Note-taking Platform + IA).

## Tech Stack & Architecture
- **Monorepo:** Standard npm/yarn workspaces containing `/backend` and `/frontend`.
- **Backend:** Node.js, TypeScript, modular feature-based architecture (resolvers separated from services).
- **Frontend:** Next.js (App Router), TypeScript, TailwindCSS, shadcn/ui.
- **Database:** PostgreSQL with `pgvector` extension (Neon in production, local Docker container for development).
- **Real-time:** GraphQL (Queries, Mutations, Subscriptions).
- **Text Editor:** BlockNote (block-based rich text editor).

## AI, Embeddings & Resilience Rules
- **Primary Model:** Generate embeddings via **OpenRouter API** using a free model (e.g., `nvidia/llama-nemotron-embed-vl-1b-v2:free` or equivalent, using its respective dimensions like 1024).
- **Vector Storage:** Store embeddings in a `vector(1024)` column in PostgreSQL (matching the exact dimension of the chosen OpenRouter model).
- **Resilience Fallback:** If the OpenRouter API fails (due to rate limits, network errors, or downtime), save the note content successfully but set a flag (e.g., `embedding_pending = true`) and handle the failure gracefully without crashing the UI. Inform the user that semantic indexing is queued.
- **Semantic Search:** Query Postgres using pgvector's cosine distance operator (`<=>`).
- **Security:** OpenRouter API keys must be loaded securely via backend environment variables (`OPENROUTER_API_KEY`).

## Code Quality & Production-Ready Standards
- **Strict TypeScript:** Never use `any`. Define strict interfaces/types for all payloads, database models, and GraphQL schemas.
- **Async Handling:** Always use `async/await` with clean `try/catch` blocks.
- **Self-Documenting:** Use clean, intent-revealing variable names. Add JSDoc comments only on complex logic.
- **UX & State Management:** Always handle loading, empty, and error states gracefully. 
- **Free-Tier Host Awareness:** Since the backend is hosted on a free-tier server (e.g., Render) that spins down after inactivity, implement elegant frontend loading states ("Initializing secure workspace environment...") to handle cold-starts gracefully.
- **Database Seeding:** Include database seed scripts in the backend to pre-populate 5-6 semantically rich demo notes for instant testing by recruiters.

## UI, UX & Design Consistency
- **Design System:** Always use `shadcn/ui` components located in `@/components/ui/` instead of writing raw HTML elements.
- **Styling:** Rely strictly on Tailwind CSS utility classes and semantic variables (e.g., `bg-background`, `text-foreground`, `bg-primary`, `rounded-md`). Do NOT hardcode hex colors or custom pixel values.
- **Layouts:** Isolate layouts (e.g., Sidebars, Navigation Headers) using Next.js Layout files to guarantee a consistent workspace shell across all views.

## Language & Communication
- **Chat Interaction:** The user may prompt you and chat with you in Spanish. You should reply in Spanish during the chat conversation to keep communication comfortable.
- **Code Generation:** Regardless of the chat language, **all generated code, variables, functions, database schemas, API types, and inline comments MUST be strictly in English**. No Spanish words in the codebase.