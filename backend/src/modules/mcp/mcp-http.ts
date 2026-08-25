import type { ServerResponse } from "node:http";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NotesService } from "../notes/notes.service.js";
import { logger } from "../../observability/logger.js";
import { captureException } from "../../observability/sentry.js";
import { createSynapseMcpServer } from "./mcp-server.js";
import { McpOAuthService } from "./oauth.service.js";
import { MCP_OAUTH_PATHS } from "./oauth-http.js";

export const MCP_HTTP_PATH = "/mcp";

export interface McpHttpDependencies {
  notesService: NotesService;
  oauthService: McpOAuthService;
  publicUrl: string;
}

function unauthorized(response: ServerResponse, publicUrl: string, description: string): void {
  const resourceMetadataUrl = `${publicUrl}${MCP_OAUTH_PATHS.protectedResourceMetadata}`;
  response.statusCode = 401;
  response.setHeader(
    "WWW-Authenticate",
    `Bearer realm="Synapse", error="invalid_token", error_description="${description}", resource_metadata="${resourceMetadataUrl}"`
  );
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({ error: "invalid_token", error_description: description }));
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");

  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();
  return token || null;
}

/** Streams a Web Standard `Response` (from the MCP transport) into a raw Node `ServerResponse`. */
async function writeWebResponse(webResponse: Response, response: ServerResponse): Promise<void> {
  response.statusCode = webResponse.status;

  webResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });

  if (!webResponse.body) {
    response.end();
    return;
  }

  const reader = webResponse.body.getReader();

  response.once("close", () => {
    void reader.cancel().catch(() => undefined);
  });

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      response.write(value);
    }
  } finally {
    response.end();
  }
}

/**
 * Handles one HTTP request to the remote MCP endpoint. Every request is
 * authenticated with an OAuth access token (never a browser cookie); a fresh
 * `McpServer` + Streamable HTTP transport pair is created per request
 * (stateless mode), so no server-side session state has to be kept between
 * calls from the same VS Code client.
 */
export async function handleMcpRequest(
  webRequest: Request,
  response: ServerResponse,
  dependencies: McpHttpDependencies
): Promise<void> {
  const token = readBearerToken(webRequest);

  if (!token) {
    unauthorized(response, dependencies.publicUrl, "Missing bearer access token");
    return;
  }

  let tokenContext;

  try {
    tokenContext = await dependencies.oauthService.verifyAccessToken(token);
  } catch {
    unauthorized(response, dependencies.publicUrl, "Access token is invalid, expired, or revoked");
    return;
  }

  try {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createSynapseMcpServer(dependencies.notesService, tokenContext);
    await server.connect(transport);
    const webResponse = await transport.handleRequest(webRequest);
    await writeWebResponse(webResponse, response);
  } catch (error) {
    logger.error("mcp.request_failed", { error, userId: tokenContext.userId });
    captureException(error, { component: "mcp_http", userId: tokenContext.userId });

    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "server_error" }));
    } else {
      response.end();
    }
  }
}
