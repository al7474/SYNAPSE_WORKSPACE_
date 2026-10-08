import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { validateRegistrationInput } from "../src/modules/auth/auth.service.js";

// Read before dotenv so the production guard sees the real process environment, not a local backend/.env value.
const runtimeNodeEnv = process.env.NODE_ENV;
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

const DEMO_BOARD_NAME = "Recruiter Demo Board";
const DEMO_ACCOUNT_NAME = "Recruiter Demo";
const LEGACY_DEMO_OWNER_ID = "demo_recruiter";

interface DemoAccountCredentials {
  email: string;
  name: string;
  password: string;
}

function readDemoAccountCredentials(): DemoAccountCredentials | null {
  const rawEmail = process.env.DEMO_USER_EMAIL?.trim() ?? "";
  const password = process.env.DEMO_USER_PASSWORD ?? "";

  if (!rawEmail && !password) {
    return null;
  }

  if (!rawEmail || !password) {
    throw new Error("DEMO_USER_EMAIL and DEMO_USER_PASSWORD must be set together");
  }

  const validated = validateRegistrationInput({
    name: DEMO_ACCOUNT_NAME,
    email: rawEmail,
    password,
  });

  return { name: validated.name, email: validated.email, password };
}

async function seed(): Promise<void> {
  if (runtimeNodeEnv === "production") {
    throw new Error("The demo seed must not run with NODE_ENV=production");
  }

  const credentials = readDemoAccountCredentials();

  if (!credentials) {
    console.warn("DEMO_USER_EMAIL and DEMO_USER_PASSWORD are not set; skipping the demo workspace seed.");
    return;
  }

  const bcryptCost = Number(process.env.AUTH_BCRYPT_COST || 12);
  const passwordHash = await bcrypt.hash(credentials.password, bcryptCost);
  const db = new PrismaClient();

  try {
    await db.$transaction(async (transaction) => {
      const verifiedAt = new Date();
      const existingUser = await transaction.user.findFirst({
        where: { email: { equals: credentials.email, mode: "insensitive" } },
        select: { id: true },
      });
      const user = existingUser
        ? await transaction.user.update({
            where: { id: existingUser.id },
            data: {
              name: credentials.name,
              passwordHash,
              emailVerifiedAt: verifiedAt,
              updatedAt: verifiedAt,
            },
          })
        : await transaction.user.create({
            data: {
              email: credentials.email,
              name: credentials.name,
              passwordHash,
              emailVerifiedAt: verifiedAt,
            },
          });
      const ownerId = String(user.id);

      await transaction.board.deleteMany({
        where: {
          OR: [
            { ownerKind: "legacy", ownerId: LEGACY_DEMO_OWNER_ID },
            { ownerKind: "user", ownerUserId: user.id, name: DEMO_BOARD_NAME },
          ],
        },
      });

      const board = await transaction.board.create({
        data: {
          ownerId,
          ownerKind: "user",
          ownerUserId: user.id,
          name: DEMO_BOARD_NAME,
        },
      });

      await transaction.note.createMany({
        data: demoNotes.map((note) => ({
          ownerId,
          ownerKind: "user",
          ownerUserId: user.id,
          boardId: board.id,
          title: note.title,
          content: note.content,
          embeddingPending: true,
        })),
      });
    });

    console.log(
      `Seed completed: demo account ${credentials.email} owns board ${DEMO_BOARD_NAME} with ${demoNotes.length} notes.`
    );
  } finally {
    await db.$disconnect();
  }
}

seed().catch((error) => {
  console.error("Seed failed:");
  console.error(error);
  process.exit(1);
});