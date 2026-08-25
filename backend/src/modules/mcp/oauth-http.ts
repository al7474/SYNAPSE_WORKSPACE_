import type { ServerResponse } from "node:http";
import { AuthService, normalizeEmail } from "../auth/auth.service.js";
import {
  createRateLimitKey,
  type RateLimitDecision,
  type RateLimiter,
} from "../auth/rate-limit.service.js";
import { logger } from "../../observability/logger.js";
import { captureException } from "../../observability/sentry.js";
import { McpOAuthService } from "./oauth.service.js";
import { MCP_SCOPES, McpOAuthError, type McpScope } from "./oauth.types.js";
import { parseRequestedScopes } from "./oauth.service.js";

export const MCP_OAUTH_PATHS = {
  authorizationServerMetadata: "/.well-known/oauth-authorization-server",
  protectedResourceMetadata: "/.well-known/oauth-protected-resource/mcp",
  register: "/oauth/register",
  authorize: "/oauth/authorize",
  token: "/oauth/token",
  revoke: "/oauth/revoke",
} as const;

export interface McpOAuthHttpDependencies {
  oauthService: McpOAuthService;
  authService: AuthService;
  isProduction: boolean;
  rateLimiter: RateLimiter;
  rateLimitEnabled: boolean;
  clientIp: string;
  maxBodyBytes: number;
  /** Public backend origin, e.g. `https://api.example.com`. Used as the OAuth issuer. */
  publicUrl: string;
  /** Canonical MCP resource identifier, e.g. `https://api.example.com/mcp`. */
  resource: string;
}

const AUTHORIZE_WINDOW_MS = 15 * 60 * 1000;

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  response.end(JSON.stringify(payload));
}

function sendOAuthError(
  response: ServerResponse,
  statusCode: number,
  error: string,
  description?: string
): void {
  sendJson(response, statusCode, { error, error_description: description });
}

function sendHtml(response: ServerResponse, statusCode: number, html: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(html);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function readRawBody(request: Request, maxBytes: number): Promise<string> {
  const contentLengthHeader = request.headers.get("content-length");

  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);

    if (!Number.isInteger(contentLength) || contentLength < 0 || contentLength > maxBytes) {
      throw new McpOAuthError("invalid_request", "Request body is too large");
    }
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new McpOAuthError("invalid_request", "Request body is too large");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bodyBytes);
}

async function readFormBody(request: Request, maxBytes: number): Promise<URLSearchParams> {
  const raw = await readRawBody(request, maxBytes);
  return new URLSearchParams(raw);
}

async function readJsonBody(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const raw = await readRawBody(request, maxBytes);

  if (!raw.trim()) {
    return {};
  }

  let value: unknown;

  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new McpOAuthError("invalid_request", "Request body must be valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpOAuthError("invalid_request", "Request body must be a JSON object");
  }

  return value as Record<string, unknown>;
}

function requireParam(source: URLSearchParams, name: string): string {
  const value = source.get(name);

  if (!value) {
    throw new McpOAuthError("invalid_request", `${name} is required`);
  }

  return value;
}

async function allowRateLimitedRequest(
  response: ServerResponse,
  dependencies: McpOAuthHttpDependencies,
  scope: string,
  value: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  if (!dependencies.rateLimitEnabled) {
    return true;
  }

  let decision: RateLimitDecision;

  try {
    decision = await dependencies.rateLimiter.check(createRateLimitKey(scope, value), limit, windowMs);
  } catch (error) {
    logger.error("mcp.oauth.rate_limiter_unavailable", { error, scope });
    captureException(error, { component: "mcp_oauth_rate_limiter", scope });
    sendOAuthError(response, 503, "temporarily_unavailable");
    return false;
  }

  if (!decision.allowed) {
    response.setHeader("Retry-After", String(decision.retryAfterSeconds));
    sendOAuthError(response, 429, "slow_down", "Too many requests. Please try again later.");
    return false;
  }

  return true;
}

function renderLoginPage(params: {
  fields: Record<string, string>;
  scopes: McpScope[];
  clientName: string | null;
  error?: string;
}): string {
  const hiddenInputs = Object.entries(params.fields)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`)
    .join("\n      ");
  const scopeList = params.scopes.map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join("");
  const errorBlock = params.error
    ? `<p class="error" role="alert">${escapeHtml(params.error)}</p>`
    : "";
  const clientLabel = params.clientName ? escapeHtml(params.clientName) : "an MCP client";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in to Synapse</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b0d12; color: #e6e8eb; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  main { background: #14171d; border-radius: 12px; padding: 32px; width: 340px; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }
  h1 { font-size: 1.15rem; margin: 0 0 4px; }
  p.lead { color: #9aa1ac; font-size: 0.9rem; margin: 0 0 20px; }
  label { display: block; font-size: 0.85rem; margin-bottom: 6px; color: #cbd0d6; }
  input[type="email"], input[type="password"] { width: 100%; box-sizing: border-box; padding: 10px 12px; margin-bottom: 14px; border-radius: 8px; border: 1px solid #2a2f3a; background: #0f1116; color: #e6e8eb; }
  button { width: 100%; padding: 10px 12px; border-radius: 8px; border: none; background: #4f7cff; color: white; font-weight: 600; cursor: pointer; }
  ul { margin: 0 0 20px; padding-left: 18px; color: #9aa1ac; font-size: 0.85rem; }
  .error { background: #3a1414; color: #ffb4b4; padding: 8px 12px; border-radius: 8px; font-size: 0.85rem; }
</style>
</head>
<body>
<main>
  <h1>Sign in to Synapse</h1>
  <p class="lead">${clientLabel} is requesting access to:</p>
  <ul>${scopeList}</ul>
  ${errorBlock}
  <form method="post">
    ${hiddenInputs}
    <label for="email">Email</label>
    <input id="email" type="email" name="email" required autofocus autocomplete="username" />
    <label for="password">Password</label>
    <input id="password" type="password" name="password" required autocomplete="current-password" />
    <button type="submit">Authorize</button>
  </form>
</main>
</body>
</html>`;
}

function buildAuthorizationServerMetadata(publicUrl: string): Record<string, unknown> {
  return {
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}${MCP_OAUTH_PATHS.authorize}`,
    token_endpoint: `${publicUrl}${MCP_OAUTH_PATHS.token}`,
    registration_endpoint: `${publicUrl}${MCP_OAUTH_PATHS.register}`,
    revocation_endpoint: `${publicUrl}${MCP_OAUTH_PATHS.revoke}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: MCP_SCOPES,
  };
}

function buildProtectedResourceMetadata(publicUrl: string, resource: string): Record<string, unknown> {
  return {
    resource,
    authorization_servers: [publicUrl],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ["header"],
  };
}

async function handleAuthorizeGet(
  url: URL,
  response: ServerResponse,
  dependencies: McpOAuthHttpDependencies
): Promise<void> {
  const clientId = url.searchParams.get("client_id") || "";
  const redirectUri = url.searchParams.get("redirect_uri") || "";
  const responseType = url.searchParams.get("response_type") || "";
  const codeChallenge = url.searchParams.get("code_challenge") || "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "";
  const scopeParam = url.searchParams.get("scope");
  const state = url.searchParams.get("state") || "";
  const resource = url.searchParams.get("resource") || "";

  const client = clientId ? await dependencies.oauthService.getClient(clientId) : null;

  if (!client || !redirectUri || !client.redirectUris.includes(redirectUri)) {
    sendHtml(
      response,
      400,
      `<!doctype html><html><body><h1>Invalid authorization request</h1><p>Unknown client or redirect_uri.</p></body></html>`
    );
    return;
  }

  if (responseType !== "code" || codeChallengeMethod !== "S256" || codeChallenge.length < 43) {
    const redirectError = new URL(redirectUri);
    redirectError.searchParams.set("error", "invalid_request");

    if (state) {
      redirectError.searchParams.set("state", state);
    }

    response.statusCode = 302;
    response.setHeader("Location", redirectError.toString());
    response.end();
    return;
  }

  let scopes;

  try {
    scopes = parseRequestedScopes(scopeParam);
  } catch {
    const redirectError = new URL(redirectUri);
    redirectError.searchParams.set("error", "invalid_scope");

    if (state) {
      redirectError.searchParams.set("state", state);
    }

    response.statusCode = 302;
    response.setHeader("Location", redirectError.toString());
    response.end();
    return;
  }

  sendHtml(
    response,
    200,
    renderLoginPage({
      fields: {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        scope: scopeParam || "",
        state,
        resource,
      },
      scopes,
      clientName: client.clientName,
    })
  );
}

async function handleAuthorizePost(
  request: Request,
  response: ServerResponse,
  dependencies: McpOAuthHttpDependencies
): Promise<void> {
  const body = await readFormBody(request, dependencies.maxBodyBytes);
  const clientId = requireParam(body, "client_id");
  const redirectUri = requireParam(body, "redirect_uri");
  const codeChallenge = requireParam(body, "code_challenge");
  const codeChallengeMethod = body.get("code_challenge_method") || "S256";
  const scopeParam = body.get("scope") || undefined;
  const state = body.get("state") || undefined;
  const resource = body.get("resource") || undefined;
  const email = (body.get("email") || "").trim();
  const password = body.get("password") || "";

  const client = await dependencies.oauthService.getClient(clientId);

  if (!client || !client.redirectUris.includes(redirectUri)) {
    sendHtml(response, 400, `<!doctype html><html><body><h1>Invalid authorization request</h1></body></html>`);
    return;
  }

  const scopes = parseRequestedScopes(scopeParam);
  const normalizedEmail = normalizeEmail(email);

  if (
    !(await allowRateLimitedRequest(
      response,
      dependencies,
      "mcp:oauth:authorize:ip",
      dependencies.clientIp,
      20,
      AUTHORIZE_WINDOW_MS
    ))
  ) {
    return;
  }

  if (
    !(await allowRateLimitedRequest(
      response,
      dependencies,
      "mcp:oauth:authorize:email",
      normalizedEmail,
      10,
      AUTHORIZE_WINDOW_MS
    ))
  ) {
    return;
  }

  const rerenderFields = {
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope: scopeParam || "",
    state: state || "",
    resource: resource || "",
  };

  try {
    const session = await dependencies.authService.login(email, password);

    const issued = await dependencies.oauthService.createAuthorizationCode(session.context.user, {
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scopes,
      state,
      resource,
    });

    const redirectUrl = new URL(issued.redirectUri);
    redirectUrl.searchParams.set("code", issued.code);
    if (issued.state) {
      redirectUrl.searchParams.set("state", issued.state);
    }

    response.statusCode = 302;
    response.setHeader("Location", redirectUrl.toString());
    response.end();
  } catch (error) {
    if (error instanceof McpOAuthError) {
      sendHtml(response, error.statusCode, `<!doctype html><html><body><h1>${escapeHtml(error.message)}</h1></body></html>`);
      return;
    }

    sendHtml(
      response,
      401,
      renderLoginPage({
        fields: rerenderFields,
        scopes,
        clientName: client.clientName,
        error: "Invalid email or password.",
      })
    );
  }
}

async function handleRegister(
  request: Request,
  response: ServerResponse,
  dependencies: McpOAuthHttpDependencies
): Promise<void> {
  const body = await readJsonBody(request, dependencies.maxBodyBytes);
  const redirectUris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as unknown[]) : [];
  const clientName = typeof body.client_name === "string" ? body.client_name : undefined;

  const client = await dependencies.oauthService.registerClient({
    redirectUris: redirectUris.filter((value): value is string => typeof value === "string"),
    clientName,
  });

  sendJson(response, 201, {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(new Date(client.createdAt).getTime() / 1000),
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: MCP_SCOPES.join(" "),
  });
}

async function handleToken(
  request: Request,
  response: ServerResponse,
  dependencies: McpOAuthHttpDependencies
): Promise<void> {
  const body = await readFormBody(request, dependencies.maxBodyBytes);
  const grantType = requireParam(body, "grant_type");
  const clientId = requireParam(body, "client_id");

  if (
    !(await allowRateLimitedRequest(
      response,
      dependencies,
      "mcp:oauth:token:ip",
      dependencies.clientIp,
      60,
      AUTHORIZE_WINDOW_MS
    ))
  ) {
    return;
  }

  let result;

  if (grantType === "authorization_code") {
    result = await dependencies.oauthService.exchangeAuthorizationCode({
      clientId,
      code: requireParam(body, "code"),
      codeVerifier: requireParam(body, "code_verifier"),
      redirectUri: requireParam(body, "redirect_uri"),
      resource: body.get("resource") || undefined,
    });
  } else if (grantType === "refresh_token") {
    result = await dependencies.oauthService.exchangeRefreshToken({
      clientId,
      refreshToken: requireParam(body, "refresh_token"),
      scope: body.get("scope") || undefined,
      resource: body.get("resource") || undefined,
    });
  } else {
    throw new McpOAuthError("unsupported_grant_type", `Unsupported grant_type: ${grantType}`);
  }

  sendJson(response, 200, {
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    token_type: result.tokenType,
    expires_in: result.expiresIn,
    scope: result.scope,
  });
}

async function handleRevoke(
  request: Request,
  response: ServerResponse,
  dependencies: McpOAuthHttpDependencies
): Promise<void> {
  const body = await readFormBody(request, dependencies.maxBodyBytes);
  const token = requireParam(body, "token");
  const clientId = requireParam(body, "client_id");

  await dependencies.oauthService.revokeToken(clientId, token);
  sendJson(response, 200, {});
}

export async function handleMcpOAuthRequest(
  request: Request,
  response: ServerResponse,
  dependencies: McpOAuthHttpDependencies
): Promise<void> {
  const url = new URL(request.url);

  try {
    if (request.method === "GET" && url.pathname === MCP_OAUTH_PATHS.authorizationServerMetadata) {
      sendJson(response, 200, buildAuthorizationServerMetadata(dependencies.publicUrl));
      return;
    }

    if (request.method === "GET" && url.pathname === MCP_OAUTH_PATHS.protectedResourceMetadata) {
      sendJson(
        response,
        200,
        buildProtectedResourceMetadata(dependencies.publicUrl, dependencies.resource)
      );
      return;
    }

    if (request.method === "POST" && url.pathname === MCP_OAUTH_PATHS.register) {
      await handleRegister(request, response, dependencies);
      return;
    }

    if (request.method === "GET" && url.pathname === MCP_OAUTH_PATHS.authorize) {
      await handleAuthorizeGet(url, response, dependencies);
      return;
    }

    if (request.method === "POST" && url.pathname === MCP_OAUTH_PATHS.authorize) {
      await handleAuthorizePost(request, response, dependencies);
      return;
    }

    if (request.method === "POST" && url.pathname === MCP_OAUTH_PATHS.token) {
      await handleToken(request, response, dependencies);
      return;
    }

    if (request.method === "POST" && url.pathname === MCP_OAUTH_PATHS.revoke) {
      await handleRevoke(request, response, dependencies);
      return;
    }

    response.setHeader("Allow", "GET, POST");
    sendOAuthError(response, 405, "invalid_request", "Method not allowed");
  } catch (error) {
    if (error instanceof McpOAuthError) {
      sendOAuthError(response, error.statusCode, error.code, error.message);
      return;
    }

    logger.error("mcp.oauth.request_failed", { error, path: url.pathname });
    captureException(error, { component: "mcp_oauth_http" });
    sendOAuthError(response, 500, "server_error");
  }
}
