import bcrypt from "bcrypt";
import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AuthActionTokenPurpose,
  AuthSessionContext,
  AuthUser,
} from "./auth.types.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;
const INVALID_LOGIN_MESSAGE = "The credentials do not match.";
const DUMMY_PASSWORD_HASH = "$2b$12$2c6DAXfFlGAuWN7KWB31UeY.i/eBFBHo25GE2i87JFqsnVpYihZTO";

type UserRow = {
  id: string | number;
  email: string;
  name: string;
  password_hash: string;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type SessionUserRow = {
  session_id: string | number;
  user_id: string | number;
  expires_at: Date;
  email: string;
  name: string;
  email_verified_at: Date | null;
};

type ActionTokenRow = {
  id: string | number;
  user_id: string | number;
};

type DbExecutor = Pool | PoolClient;

export type AuthErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CREDENTIALS"
  | "INVALID_TOKEN"
  | "USER_NOT_FOUND";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface AuthSessionResult {
  token: string;
  context: AuthSessionContext;
}

export interface AuthTokenResult {
  user: AuthUser;
  token: string;
}

export interface AuthServiceOptions {
  sessionTtlMs: number;
  actionTokenTtlMs: number;
  bcryptCost: number;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(
      "INVALID_INPUT",
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
    );
  }

  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    throw new AuthError("INVALID_INPUT", "Password is too long");
  }
}

export function validateRegistrationInput(input: RegisterInput): {
  name: string;
  email: string;
} {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);

  if (name.length < 2) {
    throw new AuthError("INVALID_INPUT", "Name must be at least 2 characters");
  }

  if (!EMAIL_PATTERN.test(email)) {
    throw new AuthError("INVALID_INPUT", "Please use a valid email address");
  }

  validatePassword(input.password);

  return { name, email };
}

function createOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toAuthUser(row: Pick<UserRow, "id" | "email" | "name" | "email_verified_at">): AuthUser {
  return {
    id: String(row.id),
    email: row.email,
    name: row.name,
    emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly options: AuthServiceOptions
  ) {}

  async register(input: RegisterInput): Promise<{ verification: AuthTokenResult } | null> {
    const { name, email } = validateRegistrationInput(input);
    const passwordHash = await bcrypt.hash(input.password, this.options.bcryptCost);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      let userResult;

      try {
        userResult = await client.query<UserRow>(
          `
          INSERT INTO users (email, name, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id, email, name, password_hash, email_verified_at, created_at, updated_at
          `,
          [email, name, passwordHash]
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          await client.query("ROLLBACK");
          return null;
        }

        throw error;
      }

      const user = toAuthUser(userResult.rows[0]);
      const verification = await this.createActionToken(
        user,
        "email_verification",
        client
      );

      await client.query("COMMIT");

      return { verification };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async login(emailInput: string, password: string): Promise<AuthSessionResult> {
    const email = normalizeEmail(emailInput);

    if (!EMAIL_PATTERN.test(email) || !password) {
      throw new AuthError("INVALID_CREDENTIALS", INVALID_LOGIN_MESSAGE, 401);
    }

    const result = await this.pool.query<UserRow>(
      `
      SELECT id, email, name, password_hash, email_verified_at, created_at, updated_at
      FROM users
      WHERE LOWER(email) = $1
      `,
      [email]
    );
    const userRow = result.rows[0];
    const passwordHash = userRow?.password_hash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await bcrypt.compare(password, passwordHash);

    if (!userRow || !passwordMatches) {
      throw new AuthError("INVALID_CREDENTIALS", INVALID_LOGIN_MESSAGE, 401);
    }

    return this.createSession(toAuthUser(userRow));
  }

  async resolveSession(token: string): Promise<AuthSessionContext | null> {
    const result = await this.pool.query<SessionUserRow>(
      `
      SELECT
        s.id AS session_id,
        s.user_id,
        s.expires_at,
        u.email,
        u.name,
        u.email_verified_at
      FROM auth_sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
      `,
      [hashToken(token)]
    );
    const row = result.rows[0];

    if (!row) {
      await this.pool.query(
        `UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND expires_at <= NOW()`,
        [hashToken(token)]
      );
      return null;
    }

    await this.pool.query(
      `UPDATE auth_sessions SET last_activity_at = NOW() WHERE id = $1`,
      [row.session_id]
    );

    return {
      sessionId: String(row.user_id),
      user: {
        id: String(row.user_id),
        email: row.email,
        name: row.name,
        emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
      },
      expiresAt: row.expires_at,
    };
  }

  async revokeSession(token: string): Promise<boolean> {
    const result = await this.pool.query(
      `
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE token_hash = $1 AND revoked_at IS NULL
      `,
      [hashToken(token)]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async purgeExpired(): Promise<{ sessions: number; actionTokens: number }> {
    const sessionResult = await this.pool.query(
      `
      DELETE FROM auth_sessions
      WHERE expires_at <= NOW() OR revoked_at IS NOT NULL
      `
    );
    const actionTokenResult = await this.pool.query(
      `
      DELETE FROM auth_action_tokens
      WHERE expires_at <= NOW() OR consumed_at IS NOT NULL
      `
    );

    return {
      sessions: sessionResult.rowCount ?? 0,
      actionTokens: actionTokenResult.rowCount ?? 0,
    };
  }

  async requestPasswordReset(emailInput: string): Promise<AuthTokenResult | null> {
    const email = normalizeEmail(emailInput);
    const result = await this.pool.query<UserRow>(
      `
      SELECT id, email, name, password_hash, email_verified_at, created_at, updated_at
      FROM users
      WHERE LOWER(email) = $1
      `,
      [email]
    );
    const userRow = result.rows[0];

    if (!userRow) {
      return null;
    }

    const user = toAuthUser(userRow);
    return this.createActionToken(user, "password_reset");
  }

  async requestEmailVerification(userId: string): Promise<AuthTokenResult | null> {
    const result = await this.pool.query<UserRow>(
      `
      SELECT id, email, name, password_hash, email_verified_at, created_at, updated_at
      FROM users
      WHERE id = $1
      `,
      [userId]
    );
    const userRow = result.rows[0];

    if (!userRow) {
      throw new AuthError("USER_NOT_FOUND", "User not found", 404);
    }

    const user = toAuthUser(userRow);

    if (user.emailVerifiedAt) {
      return null;
    }

    return this.createActionToken(user, "email_verification");
  }

  async verifyEmail(token: string): Promise<AuthUser> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const tokenResult = await client.query<ActionTokenRow>(
        `
        SELECT id, user_id
        FROM auth_action_tokens
        WHERE token_hash = $1
          AND purpose = 'email_verification'
          AND consumed_at IS NULL
          AND expires_at > NOW()
        FOR UPDATE
        `,
        [hashToken(token)]
      );
      const tokenRow = tokenResult.rows[0];

      if (!tokenRow) {
        throw new AuthError("INVALID_TOKEN", "Verification token is invalid or expired");
      }

      const userResult = await client.query<UserRow>(
        `
        UPDATE users
        SET email_verified_at = COALESCE(email_verified_at, NOW()),
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, name, password_hash, email_verified_at, created_at, updated_at
        `,
        [tokenRow.user_id]
      );
      const user = userResult.rows[0];

      if (!user) {
        throw new AuthError("USER_NOT_FOUND", "User not found", 404);
      }

      await client.query(
        `UPDATE auth_action_tokens SET consumed_at = NOW() WHERE id = $1`,
        [tokenRow.id]
      );
      await client.query("COMMIT");
      return toAuthUser(user);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    validatePassword(password);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const tokenResult = await client.query<ActionTokenRow>(
        `
        SELECT id, user_id
        FROM auth_action_tokens
        WHERE token_hash = $1
          AND purpose = 'password_reset'
          AND consumed_at IS NULL
          AND expires_at > NOW()
        FOR UPDATE
        `,
        [hashToken(token)]
      );
      const tokenRow = tokenResult.rows[0];

      if (!tokenRow) {
        throw new AuthError("INVALID_TOKEN", "Password reset token is invalid or expired");
      }

      const passwordHash = await bcrypt.hash(password, this.options.bcryptCost);
      await client.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [passwordHash, tokenRow.user_id]
      );
      await client.query(
        `UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
        [tokenRow.user_id]
      );
      await client.query(
        `
        UPDATE auth_action_tokens
        SET consumed_at = NOW()
        WHERE user_id = $1 AND purpose = 'password_reset' AND consumed_at IS NULL
        `,
        [tokenRow.user_id]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async changePassword(
    sessionToken: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    if (!currentPassword) {
      throw new AuthError("INVALID_CREDENTIALS", "Invalid current password", 401);
    }

    validatePassword(newPassword);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const sessionResult = await client.query<{
        user_id: string | number;
        password_hash: string;
      }>(
        `
        SELECT s.user_id, u.password_hash
        FROM auth_sessions s
        INNER JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
        FOR UPDATE
        `,
        [hashToken(sessionToken)]
      );
      const sessionRow = sessionResult.rows[0];

      if (!sessionRow || !(await bcrypt.compare(currentPassword, sessionRow.password_hash))) {
        throw new AuthError("INVALID_CREDENTIALS", "Invalid current password", 401);
      }

      const passwordHash = await bcrypt.hash(newPassword, this.options.bcryptCost);
      await client.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [passwordHash, sessionRow.user_id]
      );
      await client.query(
        `UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
        [sessionRow.user_id]
      );
      await client.query(
        `
        UPDATE auth_action_tokens
        SET consumed_at = NOW()
        WHERE user_id = $1 AND purpose = 'password_reset' AND consumed_at IS NULL
        `,
        [sessionRow.user_id]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async createSession(user: AuthUser, executor: DbExecutor = this.pool): Promise<AuthSessionResult> {
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.options.sessionTtlMs);

    const result = await executor.query<{ id: string | number }>(
      `
      INSERT INTO auth_sessions (token_hash, user_id, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [hashToken(token), user.id, expiresAt]
    );

    return {
      token,
      context: {
        sessionId: user.id,
        user,
        expiresAt,
      },
    };
  }

  private async createActionToken(
    user: AuthUser,
    purpose: AuthActionTokenPurpose,
    executor: DbExecutor = this.pool
  ): Promise<AuthTokenResult> {
    await executor.query(
      `
      UPDATE auth_action_tokens
      SET consumed_at = NOW()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
      `,
      [user.id, purpose]
    );

    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.options.actionTokenTtlMs);

    await executor.query(
      `
      INSERT INTO auth_action_tokens (user_id, token_hash, purpose, expires_at)
      VALUES ($1, $2, $3, $4)
      `,
      [user.id, hashToken(token), purpose, expiresAt]
    );

    return { user, token };
  }
}