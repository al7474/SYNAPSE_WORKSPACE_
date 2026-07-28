import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

export const GUEST_SESSION_COOKIE_NAME = "synapse_guest_session";

type DbClient = PrismaClient | Prisma.TransactionClient;

type GuestSessionRow = {
  id: bigint;
  ownerId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type GuestSession = {
  id: string;
  ownerId: string;
  expiresAt: Date;
  token: string;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function readGuestSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();

    if (name !== GUEST_SESSION_COOKIE_NAME) {
      continue;
    }

    const value = cookie.slice(separatorIndex + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }

  return null;
}

export function serializeGuestSessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const secureAttribute = secure ? "; Secure" : "";
  return `${GUEST_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=${secure ? "None" : "Lax"}${secureAttribute}`;
}

export function clearGuestSessionCookie(secure: boolean): string {
  const secureAttribute = secure ? "; Secure" : "";
  return `${GUEST_SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=${secure ? "None" : "Lax"}${secureAttribute}`;
}

export class GuestSessionService {
  constructor(
    private readonly db: PrismaClient,
    private readonly ttlMs: number
  ) {}

  async createOrReuse(existingToken: string | null): Promise<GuestSession> {
    if (existingToken) {
      const existingSession = await this.resolve(existingToken);

      if (existingSession) {
        return existingSession;
      }
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const ownerId = `guest_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + this.ttlMs);
    const row = await this.db.guestSession.create({
      data: {
        tokenHash: hashToken(token),
        ownerId,
        expiresAt,
      },
    });

    return {
      id: String(row.id),
      ownerId: row.ownerId,
      expiresAt: row.expiresAt,
      token,
    };
  }

  async resolve(token: string): Promise<GuestSession | null> {
    const row = await this.db.guestSession.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!row || row.revokedAt) {
      return null;
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      await this.revoke(token);
      return null;
    }

    return {
      id: String(row.id),
      ownerId: row.ownerId,
      expiresAt: row.expiresAt,
      token,
    };
  }

  async revoke(token: string): Promise<boolean> {
    return this.db.$transaction(async (transaction) => {
      const row = await transaction.guestSession.findUnique({
        where: { tokenHash: hashToken(token) },
      });

      if (!row || row.revokedAt) {
        return false;
      }

      const revokedAt = new Date();
      const claimed = await transaction.guestSession.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt },
      });

      if (claimed.count === 0) {
        return false;
      }

      await this.deleteOwnerData(transaction, row.ownerId);
      return true;
    });
  }

  async purgeExpired(): Promise<number> {
    return this.db.$transaction(async (transaction) => {
      const rows: GuestSessionRow[] = await transaction.guestSession.findMany({
        where: {
          expiresAt: { lte: new Date() },
          revokedAt: null,
        },
        select: {
          id: true,
          ownerId: true,
          expiresAt: true,
          revokedAt: true,
        },
      });
      let purgedCount = 0;

      for (const row of rows) {
        const claimed = await transaction.guestSession.updateMany({
          where: { id: row.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        if (claimed.count === 0) {
          continue;
        }

        await this.deleteOwnerData(transaction, row.ownerId);
        purgedCount += 1;
      }

      return purgedCount;
    });
  }

  private async deleteOwnerData(client: DbClient, ownerId: string): Promise<void> {
    await client.board.deleteMany({ where: { ownerId } });
  }
}