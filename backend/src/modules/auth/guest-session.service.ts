import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";

export const GUEST_SESSION_COOKIE_NAME = "synapse_guest_session";

type GuestSessionRow = {
  id: string | number;
  owner_id: string;
  expires_at: Date;
};

export type GuestSession = {
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
    private readonly pool: Pool,
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

    const result = await this.pool.query<GuestSessionRow>(
      `
      INSERT INTO guest_sessions (token_hash, owner_id, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id, owner_id, expires_at
      `,
      [hashToken(token), ownerId, expiresAt]
    );

    const row = result.rows[0];

    return {
      ownerId: row.owner_id,
      expiresAt: row.expires_at,
      token,
    };
  }

  async resolve(token: string): Promise<GuestSession | null> {
    const result = await this.pool.query<GuestSessionRow>(
      `
      SELECT id, owner_id, expires_at
      FROM guest_sessions
      WHERE token_hash = $1 AND revoked_at IS NULL
      `,
      [hashToken(token)]
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    if (row.expires_at.getTime() <= Date.now()) {
      await this.revoke(token);
      return null;
    }

    return {
      ownerId: row.owner_id,
      expiresAt: row.expires_at,
      token,
    };
  }

  async revoke(token: string): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query<GuestSessionRow>(
        `
        SELECT id, owner_id, expires_at
        FROM guest_sessions
        WHERE token_hash = $1 AND revoked_at IS NULL
        FOR UPDATE
        `,
        [hashToken(token)]
      );

      const row = result.rows[0];

      if (!row) {
        await client.query("COMMIT");
        return false;
      }

      await this.deleteOwnerData(client, row.owner_id);
      await client.query(
        `UPDATE guest_sessions SET revoked_at = NOW() WHERE id = $1`,
        [row.id]
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async purgeExpired(): Promise<number> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query<GuestSessionRow>(
        `
        SELECT id, owner_id, expires_at
        FROM guest_sessions
        WHERE expires_at <= NOW() AND revoked_at IS NULL
        FOR UPDATE
        `
      );

      for (const row of result.rows) {
        await this.deleteOwnerData(client, row.owner_id);
        await client.query(
          `UPDATE guest_sessions SET revoked_at = NOW() WHERE id = $1`,
          [row.id]
        );
      }

      await client.query("COMMIT");
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async deleteOwnerData(client: PoolClient, ownerId: string): Promise<void> {
    await client.query(`DELETE FROM boards WHERE owner_id = $1`, [ownerId]);
  }
}