import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, "..");
const repoRoot = path.resolve(backendDir, "..");

dotenv.config({ path: path.join(backendDir, ".env"), override: true });
dotenv.config({ path: path.join(repoRoot, ".env") });

type DemoNote = {
  title: string;
  content: string;
};

const demoNotes: DemoNote[] = [
  {
    title: "Product Vision - Synapse Workspace",
    content:
      "Synapse Workspace helps distributed teams transform raw meeting notes into shared knowledge. The product promise is simple: write once, retrieve instantly, and collaborate in real time. The north-star metric for the next quarter is weekly active teams that run at least one semantic search session.",
  },
  {
    title: "Architecture Decisions",
    content:
      "Backend stack uses GraphQL Yoga and PostgreSQL with pgvector. We separate resolvers from services to keep business logic testable and composable. Frontend uses Next.js App Router, TailwindCSS, and reusable shadcn-style primitives. Real-time updates come from GraphQL subscriptions to keep notes synchronized across collaborators.",
  },
  {
    title: "Onboarding Checklist",
    content:
      "1. Create account and first board. 2. Add three starter notes: product brief, meeting recap, and action plan. 3. Invite one collaborator with edit access. 4. Validate semantic search by querying decisions, roadmap, and blockers. 5. Confirm autosave and real-time sync are functioning for all participants.",
  },
  {
    title: "Cold Start UX Guidelines",
    content:
      "Because the backend runs on a free-tier host, users may experience startup latency. During cold starts, the interface should show an explicit status message: Initializing secure workspace environment. Controls must remain visible while network actions display loading indicators instead of blank states.",
  },
  {
    title: "Semantic Search Playbook",
    content:
      "Write notes with clear intent, domain nouns, and outcome statements. Run semantic search using focused prompts such as risk mitigation plan, realtime architecture, onboarding sequence, or product vision. If embeddings are pending, keep notes available and mark indexing as queued without interrupting editing.",
  },
  {
    title: "Recruiter Demo Script",
    content:
      "Open the workspace, create a board, and show note editing with autosave. Next, run a semantic query for architecture decisions and highlight ranked results. Finally, share the board link and demonstrate collaborator permissions. This flow communicates product value in less than three minutes.",
  },
];

async function seed(): Promise<void> {
  const db = new PrismaClient();
  const demoOwnerId = "demo_recruiter";
  const demoBoardName = "Recruiter Demo Board";

  try {
    await db.$transaction(async (transaction) => {
      await transaction.board.deleteMany({ where: { ownerId: demoOwnerId } });

      const board = await transaction.board.create({
        data: {
          ownerId: demoOwnerId,
          ownerKind: "legacy",
          name: demoBoardName,
        },
      });

      await transaction.note.createMany({
        data: demoNotes.map((note) => ({
          ownerId: demoOwnerId,
          ownerKind: "legacy",
          boardId: board.id,
          title: note.title,
          content: note.content,
          embeddingPending: true,
        })),
      });
    });

    console.log(`Seed completed with ${demoNotes.length} demo notes in board ${demoBoardName}.`);
  } finally {
    await db.$disconnect();
  }
}

seed().catch((error) => {
  console.error("Seed failed:");
  console.error(error);
  process.exit(1);
});