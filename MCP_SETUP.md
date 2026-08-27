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

Both servers expose the same six tools:

- `list_boards`
- `create_board`
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

1. Open this repository in VS Code and allow the `synapse-production` MCP server
   when prompted. Its deployed endpoint is already defined in
   `.vscode/mcp.json`.
2. For a different backend, change the server URL to its `/mcp` endpoint before
   starting the MCP connection.
3. Do not open the authorization URL manually. VS Code discovers the OAuth
   endpoints automatically from
   `GET /.well-known/oauth-protected-resource/mcp` and
   `GET /.well-known/oauth-authorization-server`, dynamically registers itself
   as an OAuth client (`POST /oauth/register`), and opens your system browser
   to `GET /oauth/authorize`.
4. Sign in with your Synapse email and password on the page the backend
   renders. This is a plain HTML login form served directly by the backend.
   The backend verifies your password directly with the same `AuthService`
   used by `POST /auth/login`, creates a session cookie, and immediately
   issues a one-time authorization code.
5. VS Code exchanges the code for an access token (`POST /oauth/token`) using
   the PKCE code verifier it generated, and attaches
   `Authorization: Bearer <token>` to every subsequent `POST /mcp` request.

The access token lasts 1 hour by default. VS Code refreshes it automatically
using the refresh token, which lasts 30 days by default. When the session
cookie is still valid, reopening the authorization flow can complete without
asking for the email and password again. Authentication is intentionally not
permanent: revoke the connection or change the account password to invalidate
its tokens. If the refresh token expires, authorize `synapse-production` again.

The authorization page redirects to a temporary loopback callback owned by VS
Code. If the URL is opened outside a VS Code-initiated MCP connection, the
browser can show `Failed to load page` or `ERR_CONNECTION_REFUSED` because no
local callback listener is running. This does not indicate that the Synapse
login failed.

### Scopes and permissions

Every access token is limited to the scopes it was granted:

| Scope | Grants |
| --- | --- |
| `boards:read` | `list_boards` |
| `boards:create` | `create_board` |
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
