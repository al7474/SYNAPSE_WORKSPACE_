import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { Prisma, PrismaClient, type User as PrismaUser } from "@prisma/client";
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

type DbClient = PrismaClient | Prisma.TransactionClient;

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

function toAuthUser(
  row: Pick<PrismaUser, "id" | "email" | "name" | "emailVerifiedAt">
): AuthUser {
  return {
    id: String(row.id),
    email: row.email,
    name: row.name,
    emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function parseUserId(userId: string): bigint | null {
  try {
    const parsed = BigInt(userId);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

export class AuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly options: AuthServiceOptions
  ) {}

  async register(
    input: RegisterInput
  ): Promise<{ verification: AuthTokenResult; session: AuthSessionResult } | null> {
    const { name, email } = validateRegistrationInput(input);
    const passwordHash = await bcrypt.hash(input.password, this.options.bcryptCost);

    return this.db.$transaction(async (transaction) => {
      try {
        const userRow = await transaction.user.create({
          data: {
            email,
            name,
            passwordHash,
          },
        });
        const user = toAuthUser(userRow);
        const verification = await this.createActionToken(
          user,
          "email_verification",
          transaction
        );
        const session = await this.createSession(user, transaction);

        return { verification, session };
      } catch (error) {
        if (isUniqueViolation(error)) {
          return null;
        }

        throw error;
      }
    });
  }

  async login(emailInput: string, password: string): Promise<AuthSessionResult> {
    const email = normalizeEmail(emailInput);

    if (!EMAIL_PATTERN.test(email) || !password) {
      throw new AuthError("INVALID_CREDENTIALS", INVALID_LOGIN_MESSAGE, 401);
    }

    const userRow = await this.db.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
    });
    const passwordHash = userRow?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await bcrypt.compare(password, passwordHash);

    if (!userRow || !passwordMatches) {
      throw new AuthError("INVALID_CREDENTIALS", INVALID_LOGIN_MESSAGE, 401);
    }

    return this.createSession(toAuthUser(userRow));
  }

  async resolveSession(token: string): Promise<AuthSessionContext | null> {
    const tokenHash = hashToken(token);
    const now = new Date();
    const session = await this.db.authSession.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: { user: true },
    });

    if (!session) {
      await this.db.authSession.updateMany({
        where: { tokenHash, expiresAt: { lte: now } },
        data: { revokedAt: now },
      });
      return null;
    }

    await this.db.authSession.update({
      where: { id: session.id },
      data: { lastActivityAt: now },
    });

    return {
      sessionId: String(session.userId),
      user: toAuthUser(session.user),
      expiresAt: session.expiresAt,
    };
  }

  async revokeSession(token: string): Promise<boolean> {
    const result = await this.db.authSession.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return result.count > 0;
  }

  async purgeExpired(): Promise<{ sessions: number; actionTokens: number }> {
    const now = new Date();
    const sessionResult = await this.db.authSession.deleteMany({
      where: {
        OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }],
      },
    });
    const actionTokenResult = await this.db.authActionToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lte: now } }, { consumedAt: { not: null } }],
      },
    });

    return {
      sessions: sessionResult.count,
      actionTokens: actionTokenResult.count,
    };
  }

  async requestPasswordReset(emailInput: string): Promise<AuthTokenResult | null> {
    const email = normalizeEmail(emailInput);
    const userRow = await this.db.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });

    if (!userRow) {
      return null;
    }

    return this.createActionToken(toAuthUser(userRow), "password_reset");
  }

  async requestEmailVerification(userId: string): Promise<AuthTokenResult | null> {
    const parsedUserId = parseUserId(userId);

    if (!parsedUserId) {
      throw new AuthError("USER_NOT_FOUND", "User not found", 404);
    }

    const userRow = await this.db.user.findUnique({ where: { id: parsedUserId } });

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
    return this.db.$transaction(async (transaction) => {
      const now = new Date();
      const tokenRow = await transaction.authActionToken.findFirst({
        where: {
          tokenHash: hashToken(token),
          purpose: "email_verification",
          consumedAt: null,
          expiresAt: { gt: now },
        },
      });

      if (!tokenRow) {
        throw new AuthError("INVALID_TOKEN", "Verification token is invalid or expired");
      }

      const consumed = await transaction.authActionToken.updateMany({
        where: { id: tokenRow.id, consumedAt: null },
        data: { consumedAt: now },
      });

      if (consumed.count === 0) {
        throw new AuthError("INVALID_TOKEN", "Verification token is invalid or expired");
      }

      const user = await transaction.user.findUnique({ where: { id: tokenRow.userId } });

      if (!user) {
        throw new AuthError("USER_NOT_FOUND", "User not found", 404);
      }

      const verifiedUser = await transaction.user.update({
        where: { id: user.id },
        data: {
          emailVerifiedAt: user.emailVerifiedAt ?? now,
          updatedAt: now,
        },
      });

      return toAuthUser(verifiedUser);
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    validatePassword(password);

    await this.db.$transaction(async (transaction) => {
      const now = new Date();
      const tokenRow = await transaction.authActionToken.findFirst({
        where: {
          tokenHash: hashToken(token),
          purpose: "password_reset",
          consumedAt: null,
          expiresAt: { gt: now },
        },
      });

      if (!tokenRow) {
        throw new AuthError("INVALID_TOKEN", "Password reset token is invalid or expired");
      }

      const consumed = await transaction.authActionToken.updateMany({
        where: { id: tokenRow.id, consumedAt: null },
        data: { consumedAt: now },
      });

      if (consumed.count === 0) {
        throw new AuthError("INVALID_TOKEN", "Password reset token is invalid or expired");
      }

      const passwordHash = await bcrypt.hash(password, this.options.bcryptCost);
      await transaction.user.update({
        where: { id: tokenRow.userId },
        data: { passwordHash, updatedAt: now },
      });
      await transaction.authSession.updateMany({
        where: { userId: tokenRow.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.authActionToken.updateMany({
        where: {
          userId: tokenRow.userId,
          purpose: "password_reset",
          consumedAt: null,
        },
        data: { consumedAt: now },
      });
    });
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

    await this.db.$transaction(async (transaction) => {
      const session = await transaction.authSession.findFirst({
        where: {
          tokenHash: hashToken(sessionToken),
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: { user: true },
      });

      if (!session || !(await bcrypt.compare(currentPassword, session.user.passwordHash))) {
        throw new AuthError("INVALID_CREDENTIALS", "Invalid current password", 401);
      }

      const now = new Date();
      const passwordHash = await bcrypt.hash(newPassword, this.options.bcryptCost);
      await transaction.user.update({
        where: { id: session.userId },
        data: { passwordHash, updatedAt: now },
      });
      await transaction.authSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.authActionToken.updateMany({
        where: {
          userId: session.userId,
          purpose: "password_reset",
          consumedAt: null,
        },
        data: { consumedAt: now },
      });
    });
  }

  private async createSession(
    user: AuthUser,
    executor: DbClient = this.db
  ): Promise<AuthSessionResult> {
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.options.sessionTtlMs);

    await executor.authSession.create({
      data: {
        tokenHash: hashToken(token),
        userId: BigInt(user.id),
        expiresAt,
      },
    });

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
    executor: DbClient = this.db
  ): Promise<AuthTokenResult> {
    await executor.authActionToken.updateMany({
      where: { userId: BigInt(user.id), purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.options.actionTokenTtlMs);

    await executor.authActionToken.create({
      data: {
        userId: BigInt(user.id),
        tokenHash: hashToken(token),
        purpose,
        expiresAt,
      },
    });

    return { user, token };
  }
}