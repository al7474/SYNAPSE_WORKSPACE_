/**
 * Scopes exposed to remote MCP clients. Each scope gates exactly one class of
 * Synapse operation; tool handlers in `mcp-server.ts` enforce these at call time.
 */
export const MCP_SCOPES = [
  "boards:read",
  "boards:create",
  "notes:read",
  "notes:create",
  "notes:update",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

export interface McpOAuthClient {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  createdAt: string;
}

export interface RegisterClientInput {
  redirectUris: string[];
  clientName?: string;
}

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopes: McpScope[];
  state?: string;
  resource?: string;
}

export interface IssuedAuthorizationCode {
  code: string;
  redirectUri: string;
  state?: string;
}

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  scope: string;
}

/** Authenticated context attached to an inbound MCP HTTP request after bearer verification. */
export interface McpAccessTokenContext {
  token: string;
  clientId: string;
  userId: string;
  userEmail?: string;
  scopes: McpScope[];
  expiresAt: number;
  resource: string | null;
}

export type McpOAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "invalid_target"
  | "access_denied"
  | "invalid_token"
  | "insufficient_scope";

export class McpOAuthError extends Error {
  constructor(
    public readonly code: McpOAuthErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "McpOAuthError";
  }
}
