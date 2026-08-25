# Synapse MCP setup

This workspace includes two ways to use the Synapse MCP tools from GitHub
Copilot in VS Code:

- **Local stdio server (`synapse`)** — runs on your computer as a spawned
  process. Intended for development against a local or manually authenticated
  backend. See [Local stdio server](#local-stdio-server) below.
- **Remote HTTP server (`synapse-remote`)** — talks directly to a Synapse
  backend (local or deployed) over `POST /mcp`, authenticated with a
  short-lived OAuth 2.1 access token instead of a copied session cookie. See
  [Remote HTTP server](#remote-http-server-recommended) below. This is the
  recommended option for day-to-day use and the only option that works with a
  deployed backend without exposing a cookie.

Both servers expose the same five tools:

- `list_boards`
- `list_notes`
- `search_notes`
- `create_note`
- `update_note`

Copilot should request confirmation before creating or updating content.
Always provide the `boardId` returned by `list_boards`; the MCP server does not
guess a board by name.

## Remote HTTP server (recommended)

The backend exposes a Streamable HTTP MCP endpoint at `POST /mcp`, protected by
an OAuth 2.1 Authorization Code + PKCE flow (RFC 6749 + RFC 7636) that Synapse
itself implements as both the authorization server and the resource server.
There is no separate identity provider: a Synapse account **is** the identity.

1. Open this repository in VS Code and allow the `synapse-remote` MCP server
   when prompted.
2. When VS Code asks for the **Synapse remote MCP endpoint**, enter
   `http://localhost:4000/mcp` for a local backend, or
   `https://api.example.com/mcp` for a deployed backend.
3. VS Code discovers the OAuth endpoints automatically from
   `GET /.well-known/oauth-protected-resource/mcp` and
   `GET /.well-known/oauth-authorization-server`, dynamically registers itself
   as an OAuth client (`POST /oauth/register`), and opens your system browser
   to `GET /oauth/authorize`.
4. Sign in with your Synapse email and password on the page the backend
   renders. This is a plain HTML login form served directly by the backend —
   **no browser cookie is created or read for this flow**; the backend
   verifies your password directly with the same `AuthService` used by
   `POST /auth/login` and immediately issues a one-time authorization code.
5. VS Code exchanges the code for an access token (`POST /oauth/token`) using
   the PKCE code verifier it generated, and attaches
   `Authorization: Bearer <token>` to every subsequent `POST /mcp` request.

### Scopes and permissions

Every access token is limited to the scopes it was granted:

| Scope | Grants |
| --- | --- |
| `boards:read` | `list_boards` |
| `notes:read` | `list_notes`, `search_notes` |
| `notes:create` | `create_note` |
| `notes:update` | `update_note` |

Calling a tool without the required scope returns a tool error instead of
performing the action. Independently of scopes, every tool call still goes
through the same board ownership/collaborator permission checks as the GraphQL
API (`NotesService.requireBoardAccess`), so a token can never read or write a
board the signed-in user does not own or collaborate on.

Access tokens expire after 1 hour by default (`MCP_ACCESS_TOKEN_TTL_MS`); VS
Code refreshes them automatically with the refresh token
(`MCP_REFRESH_TOKEN_TTL_MS`, 30 days by default) without prompting you again.
Revoke a lost or compromised token immediately with `POST /oauth/revoke`
(`token`, `client_id`), or by changing/resetting the Synapse account's
password, which also revokes every MCP access and refresh token for that
account.

### Deployment requirements

The remote endpoint only needs the backend's existing production
configuration (`AUTH_PUBLIC_URL` must be the exact public HTTPS origin, since
it is used as the OAuth issuer and resource identifier). No additional
environment variables are required; see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#remote-mcp-oauth) for the optional
tuning variables and hosting notes.

## Local stdio server

The local server allows Copilot to read, search, create, and update notes
through the existing Synapse GraphQL API using a copied session cookie. Prefer
the remote HTTP server above unless you are actively developing the MCP
package itself.

### Requirements

- The Synapse backend must be running at `http://localhost:4000` locally, or
  provide the deployed GraphQL URL when VS Code prompts for it.
- The MCP server needs an authenticated Synapse session token.

### Getting a session token

Sign in to Synapse and obtain the value of the `synapse_auth_session` cookie
from the browser developer tools. Paste it only into the password prompt shown
by VS Code when it starts the `synapse` MCP server. Do not commit it or put it
in an environment file.

The token follows the normal Synapse session expiration and revocation rules.

### Using a deployed Synapse instance

The MCP process runs on your computer, while its GraphQL requests can target a
deployed backend. When VS Code prompts for `Synapse GraphQL URL`, enter the
public HTTPS endpoint, for example:

```text
https://api.example.com/graphql
```

Then sign in to that same deployed frontend and provide its
`synapse_auth_session` cookie. The deployed backend must allow authenticated
GraphQL requests and must be reachable from your computer. Server-to-server
MCP requests do not require frontend CORS configuration, but HTTPS and the
existing authentication/session protections must remain enabled.

