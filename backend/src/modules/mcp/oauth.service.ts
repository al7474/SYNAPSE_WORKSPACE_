import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import type { AuthUser } from "../auth/auth.types.js";
import {
  MCP_SCOPES,
  McpOAuthError,
  isMcpScope,
  type AuthorizationRequest,
  type IssuedAuthorizationCode,
  type IssuedTokenPair,
  type McpAccessTokenContext,
  type McpOAuthClient,
  type McpScope,
  type RegisterClientInput,
} from "./oauth.types.js";

export interface McpOAuthServiceOptions {
  /** Canonical resource identifier for this MCP server, e.g. `https://api.example.com/mcp`. */
  resource: string;
  authorizationCodeTtlMs: number;
  accessTokenTtlMs: number;
  refreshTokenTtlMs: number;
}

const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Restricts dynamic client registration and authorization redirects to the
 * callback shapes used by VS Code's built-in MCP OAuth client: a loopback HTTP
 * server (desktop, RFC 8252 native-app flow), the vscode.dev web redirect, or
 * the `vscode`/`vscode-insiders` deep-link scheme. Anything else is rejected so
 * an attacker cannot register a client that redirects codes to a third party.
 */
export function isAllowedRedirectUri(rawUri: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(rawUri);
  } catch {
    return false;
  }

  if (parsed.protocol === "http:") {
    const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
    return loopbackHosts.has(parsed.hostname);
  }

  if (parsed.protocol === "https:") {
    const webHosts = new Set(["vscode.dev", "insiders.vscode.dev"]);
    return webHosts.has(parsed.hostname) && parsed.pathname.startsWith("/redirect");
  }

  if (parsed.protocol === "vscode:" || parsed.protocol === "vscode-insiders:") {
    return true;
  }

  return false;
}

export function computeS256Challenge(codeVerifier: string): string {
  return crypto.createHash("sha256").update(codeVerifier).digest("base64url");
}

export function isValidCodeVerifier(codeVerifier: string): boolean {
  return CODE_VERIFIER_PATTERN.test(codeVerifier);
}

/** Parses a space-delimited OAuth `scope` string into the known MCP scope set. */
export function parseRequestedScopes(scope: string | undefined | null): McpScope[] {
  if (!scope || !scope.trim()) {
    return [...MCP_SCOPES];
  }

  const requested = scope.trim().split(/\s+/);
  const scopes: McpScope[] = [];

  for (const value of requested) {
    if (!isMcpScope(value)) {
      throw new McpOAuthError("invalid_scope", `Unsupported scope: ${value}`);
    }

    if (!scopes.includes(value)) {
      scopes.push(value);
    }
  }

  if (scopes.length === 0) {
    throw new McpOAuthError("invalid_scope", "At least one scope is required");
  }

  return scopes;
}

function toClient(row: {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  createdAt: Date;
}): McpOAuthClient {
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    redirectUris: row.redirectUris,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Implements the resource-owner-facing half of an OAuth 2.1 Authorization Code +
 * PKCE flow (RFC 6749 + RFC 7636) for remote MCP access. Synapse acts as both the
 * authorization server and resource server for its own users; there is no
 * external identity provider involved. Every issued code/token is single-use,
 * opaque, and stored only as a SHA-256 hash (never the raw value).
 */
export class McpOAuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly options: McpOAuthServiceOptions
  ) {}

  async registerClient(input: RegisterClientInput): Promise<McpOAuthClient> {
    if (!Array.isArray(input.redirectUris) || input.redirectUris.length === 0) {
      throw new McpOAuthError("invalid_request", "redirect_uris is required");
    }

    if (input.redirectUris.length > 5) {
      throw new McpOAuthError("invalid_request", "Too many redirect_uris");
    }

    for (const redirectUri of input.redirectUris) {
      if (typeof redirectUri !== "string" || !isAllowedRedirectUri(redirectUri)) {
        throw new McpOAuthError(
          "invalid_request",
          `Unsupported redirect_uri: ${String(redirectUri)}`
        );
      }
    }

    const clientName =
      typeof input.clientName === "string" ? input.clientName.trim().slice(0, 200) : null;
    const row = await this.db.mcpClient.create({
      data: {
        clientId: crypto.randomUUID(),
        clientName: clientName || null,
        redirectUris: input.redirectUris,
      },
    });

    return toClient(row);
  }

  async getClient(clientId: string): Promise<McpOAuthClient | null> {
    const row = await this.db.mcpClient.findUnique({ where: { clientId } });
    return row ? toClient(row) : null;
  }

  private assertResource(resource: string | undefined): string | null {
    if (!resource) {
      return null;
    }

    if (resource !== this.options.resource) {
      throw new McpOAuthError(
        "invalid_target",
        `resource must be ${this.options.resource}`
      );
    }

    return resource;
  }

  /** Issues a single-use authorization code bound to the PKCE challenge, for an already-authenticated user. */
  async createAuthorizationCode(
    user: AuthUser,
    request: AuthorizationRequest
  ): Promise<IssuedAuthorizationCode> {
    const client = await this.getClientOrThrow(request.clientId);

    if (!client.redirectUris.includes(request.redirectUri)) {
      throw new McpOAuthError("invalid_request", "redirect_uri is not registered for this client");
    }

    if (request.codeChallengeMethod !== "S256") {
      throw new McpOAuthError(
        "invalid_request",
        "code_challenge_method must be S256"
      );
    }

    if (!request.codeChallenge || request.codeChallenge.length < 43) {
      throw new McpOAuthError("invalid_request", "code_challenge is required");
    }

    const resource = this.assertResource(request.resource);
    const code = createOpaqueToken();

    await this.db.mcpAuthorizationCode.create({
      data: {
        codeHash: hashToken(code),
        clientId: BigInt(await this.getClientRowId(request.clientId)),
        userId: BigInt(user.id),
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        codeChallengeMethod: "S256",
        scopes: request.scopes,
        resource,
        expiresAt: new Date(Date.now() + this.options.authorizationCodeTtlMs),
      },
    });

    return { code, redirectUri: request.redirectUri, state: request.state };
  }

  async exchangeAuthorizationCode(input: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    resource?: string;
  }): Promise<IssuedTokenPair> {
    if (!isValidCodeVerifier(input.codeVerifier)) {
      throw new McpOAuthError("invalid_grant", "code_verifier is malformed");
    }

    return this.db.$transaction(async (transaction) => {
      const codeRow = await transaction.mcpAuthorizationCode.findUnique({
        where: { codeHash: hashToken(input.code) },
        include: { client: true },
      });

      if (!codeRow || codeRow.consumedAt || codeRow.expiresAt.getTime() <= Date.now()) {
        throw new McpOAuthError("invalid_grant", "Authorization code is invalid or expired");
      }

      if (codeRow.client.clientId !== input.clientId) {
        throw new McpOAuthError("invalid_grant", "Authorization code was not issued to this client");
      }

      if (codeRow.redirectUri !== input.redirectUri) {
        throw new McpOAuthError("invalid_grant", "redirect_uri does not match the authorization request");
      }

      const expectedChallenge = computeS256Challenge(input.codeVerifier);

      if (!timingSafeEqualStrings(expectedChallenge, codeRow.codeChallenge)) {
        throw new McpOAuthError("invalid_grant", "code_verifier does not match code_challenge");
      }

      const consumed = await transaction.mcpAuthorizationCode.updateMany({
        where: { id: codeRow.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      if (consumed.count === 0) {
        throw new McpOAuthError("invalid_grant", "Authorization code was already used");
      }

      const resource = this.assertResource(input.resource) ?? codeRow.resource ?? null;
      const scopes = codeRow.scopes.filter(isMcpScope);

      return this.issueTokenPair(transaction, {
        clientRowId: codeRow.clientId,
        userId: codeRow.userId,
        scopes,
        resource,
      });
    });
  }

  async exchangeRefreshToken(input: {
    clientId: string;
    refreshToken: string;
    scope?: string;
    resource?: string;
  }): Promise<IssuedTokenPair> {
    return this.db.$transaction(async (transaction) => {
      const tokenRow = await transaction.mcpRefreshToken.findUnique({
        where: { tokenHash: hashToken(input.refreshToken) },
        include: { client: true },
      });

      if (!tokenRow || tokenRow.revokedAt || tokenRow.expiresAt.getTime() <= Date.now()) {
        throw new McpOAuthError("invalid_grant", "Refresh token is invalid or expired");
      }

      if (tokenRow.client.clientId !== input.clientId) {
        throw new McpOAuthError("invalid_grant", "Refresh token was not issued to this client");
      }

      const now = new Date();
      await transaction.mcpRefreshToken.update({
        where: { id: tokenRow.id },
        data: { revokedAt: now },
      });

      if (tokenRow.accessTokenId) {
        await transaction.mcpAccessToken.updateMany({
          where: { id: tokenRow.accessTokenId, revokedAt: null },
          data: { revokedAt: now },
        });
      }

      const existingScopes = tokenRow.scopes.filter(isMcpScope);
      const requestedScopes = input.scope ? parseRequestedScopes(input.scope) : existingScopes;
      const narrowedScopes = requestedScopes.filter((scope) => existingScopes.includes(scope));

      if (narrowedScopes.length === 0) {
        throw new McpOAuthError("invalid_scope", "Requested scope exceeds the original grant");
      }

      const resource = this.assertResource(input.resource) ?? tokenRow.resource ?? null;

      return this.issueTokenPair(transaction, {
        clientRowId: tokenRow.clientId,
        userId: tokenRow.userId,
        scopes: narrowedScopes,
        resource,
      });
    });
  }

  async verifyAccessToken(token: string): Promise<McpAccessTokenContext> {
    const row = await this.db.mcpAccessToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { client: true, user: true },
    });

    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new McpOAuthError("invalid_token", "Access token is invalid, expired, or revoked", 401);
    }

    return {
      token,
      clientId: row.client.clientId,
      userId: String(row.userId),
      userEmail: row.user.emailVerifiedAt ? row.user.email : undefined,
      scopes: row.scopes.filter(isMcpScope),
      expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
      resource: row.resource,
    };
  }

  async revokeToken(clientId: string, token: string): Promise<void> {
    const tokenHash = hashToken(token);
    const now = new Date();

    await this.db.mcpAccessToken.updateMany({
      where: { tokenHash, client: { clientId }, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.db.mcpRefreshToken.updateMany({
      where: { tokenHash, client: { clientId }, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async purgeExpired(): Promise<{ codes: number; accessTokens: number; refreshTokens: number }> {
    const now = new Date();
    const codes = await this.db.mcpAuthorizationCode.deleteMany({
      where: { OR: [{ expiresAt: { lte: now } }, { consumedAt: { not: null } }] },
    });
    const accessTokens = await this.db.mcpAccessToken.deleteMany({
      where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] },
    });
    const refreshTokens = await this.db.mcpRefreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] },
    });

    return {
      codes: codes.count,
      accessTokens: accessTokens.count,
      refreshTokens: refreshTokens.count,
    };
  }

  private async issueTokenPair(
    transaction: Prisma.TransactionClient,
    input: { clientRowId: bigint; userId: bigint; scopes: McpScope[]; resource: string | null }
  ): Promise<IssuedTokenPair> {
    const accessToken = createOpaqueToken();
    const refreshToken = createOpaqueToken();
    const now = Date.now();
    const accessTokenRow = await transaction.mcpAccessToken.create({
      data: {
        tokenHash: hashToken(accessToken),
        clientId: input.clientRowId,
        userId: input.userId,
        scopes: input.scopes,
        resource: input.resource,
        expiresAt: new Date(now + this.options.accessTokenTtlMs),
      },
    });
    await transaction.mcpRefreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        clientId: input.clientRowId,
        userId: input.userId,
        scopes: input.scopes,
        resource: input.resource,
        accessTokenId: accessTokenRow.id,
        expiresAt: new Date(now + this.options.refreshTokenTtlMs),
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: Math.floor(this.options.accessTokenTtlMs / 1000),
      scope: input.scopes.join(" "),
    };
  }

  private async getClientOrThrow(clientId: string): Promise<McpOAuthClient> {
    const client = await this.getClient(clientId);

    if (!client) {
      throw new McpOAuthError("invalid_client", "Unknown client_id", 401);
    }

    return client;
  }

  private async getClientRowId(clientId: string): Promise<bigint> {
    const row = await this.db.mcpClient.findUnique({
      where: { clientId },
      select: { id: true },
    });

    if (!row) {
      throw new McpOAuthError("invalid_client", "Unknown client_id", 401);
    }

    return row.id;
  }
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
}
