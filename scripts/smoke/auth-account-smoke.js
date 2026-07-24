import { Pool } from "pg";

const BASE_URL = process.env.AUTH_SMOKE_BASE_URL || "http://localhost:4000";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5434/synapse";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path, method, body, cookie) {
  const headers = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  const requestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(10000),
  };

  if (body) {
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, requestInit);
  const text = await response.text();

  return {
    response,
    payload: text ? JSON.parse(text) : null,
  };
}

async function requestGraphQL(query, cookie) {
  const headers = { "content-type": "application/json" };

  if (cookie) {
    headers.Cookie = cookie;
  }

  const response = await fetch(`${BASE_URL}/graphql`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10000),
  });

  return {
    response,
    payload: await response.json(),
  };
}

async function main() {
  const email = `auth-smoke-${Date.now()}@example.com`;
  const password = "correct-horse-123";
  const pool = new Pool({ connectionString: DATABASE_URL });
  let userId = null;

  try {
    const preflight = await fetch(`${BASE_URL}/auth/register`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });

    assert(preflight.status === 204, `Auth preflight returned ${preflight.status}`);

    const registered = await requestJson("/auth/register", "POST", {
      name: "Auth Smoke",
      email,
      password,
    });

    assert(registered.response.status === 201, "Registration failed");

    const registerCookieHeader = registered.response.headers.get("set-cookie");
    assert(Boolean(registerCookieHeader), "Registration did not set a session cookie");
    assert(registerCookieHeader.includes("HttpOnly"), "Session cookie is not HttpOnly");
    assert(registerCookieHeader.includes("SameSite=Lax"), "Session cookie has the wrong SameSite policy");
    assert(registerCookieHeader.includes("Path=/"), "Session cookie has no root path");

    const registerCookie = registerCookieHeader.split(";")[0];
    userId = registered.payload.user.id;

    assert(registered.payload.user.emailVerified === false, "New account should require email verification");

    const currentSession = await requestJson("/auth/session", "GET", null, registerCookie);
    assert(currentSession.response.status === 200, "Current session lookup failed");
    assert(currentSession.payload.user.email === email, "Current session returned the wrong user");

    const boards = await requestGraphQL("{ listBoards { id ownerId name } }", registerCookie);
    assert(!boards.payload.errors, `Authenticated GraphQL query failed: ${JSON.stringify(boards.payload)}`);
    assert(boards.payload.data.listBoards.length > 0, "Account did not receive an initial board");
    assert(String(boards.payload.data.listBoards[0].ownerId) === String(userId), "Board ownership is not typed to the user");

    const boardId = boards.payload.data.listBoards[0].id;
    const deleteBoard = await requestGraphQL(
      `mutation { deleteBoard(id: "${boardId}") }`,
      registerCookie
    );
    assert(deleteBoard.payload.data?.deleteBoard === true, "Smoke board cleanup failed");

    const loggedOut = await requestJson("/auth/logout", "POST", null, registerCookie);
    assert(loggedOut.response.status === 200, "Logout failed");
    assert(loggedOut.response.headers.get("set-cookie")?.includes("Max-Age=0"), "Logout did not clear the session cookie");

    const revokedSession = await requestJson("/auth/session", "GET", null, registerCookie);
    assert(revokedSession.response.status === 401, "Logged-out session remained active");

    const loggedIn = await requestJson("/auth/login", "POST", { email, password });
    assert(loggedIn.response.status === 200, "Login failed after registration");
    const loginCookieHeader = loggedIn.response.headers.get("set-cookie");
    assert(Boolean(loginCookieHeader), "Login did not set a session cookie");

    const knownReset = await requestJson("/auth/password-reset/request", "POST", { email });
    const unknownReset = await requestJson("/auth/password-reset/request", "POST", {
      email: "missing-auth-smoke@example.com",
    });
    assert(knownReset.response.status === 202, "Known-email password reset request failed");
    assert(unknownReset.response.status === 202, "Unknown-email password reset request leaked account state");
    assert(
      JSON.stringify(knownReset.payload) === JSON.stringify(unknownReset.payload),
      "Password reset responses are not generic"
    );

    const wrongLogin = await requestJson("/auth/login", "POST", {
      email,
      password: "wrong-password",
    });
    assert(wrongLogin.response.status === 401, "Invalid password was accepted");

    console.log(
      JSON.stringify(
        {
          email,
          userId,
          registerStatus: registered.response.status,
          currentSessionStatus: currentSession.response.status,
          graphQLOwnerId: boards.payload.data.listBoards[0].ownerId,
          logoutStatus: loggedOut.response.status,
          loginStatus: loggedIn.response.status,
          resetStatus: knownReset.response.status,
          wrongLoginStatus: wrongLogin.response.status,
        },
        null,
        2
      )
    );
  } finally {
    if (userId) {
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    }

    await pool.end();
  }
}

main().catch((error) => {
  console.error("Account authentication smoke test failed:");
  console.error(error);
  process.exit(1);
});