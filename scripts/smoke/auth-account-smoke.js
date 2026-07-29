import { Pool } from "pg";

const BASE_URL = process.env.AUTH_SMOKE_BASE_URL || "http://localhost:4000";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5434/synapse";

let csrfCookie = null;
let csrfToken = null;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureCsrfToken() {
  if (csrfToken && csrfCookie) {
    return;
  }

  const response = await fetch(`${BASE_URL}/auth/csrf`, {
    method: "GET",
    headers: { Accept: "application/json", Origin: "http://localhost:3000" },
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json();
  const setCookie = response.headers.get("set-cookie") || "";

  assert(response.ok, "CSRF bootstrap failed");
  assert(typeof payload.csrfToken === "string", "CSRF bootstrap did not return a token");
  assert(setCookie.includes("synapse_csrf_token="), "CSRF bootstrap did not set a cookie");

  csrfToken = payload.csrfToken;
  csrfCookie = setCookie.split(";")[0];
}

function withCookies(cookie) {
  return [csrfCookie, cookie].filter(Boolean).join("; ");
}

async function requestJson(path, method, body, cookie) {
  await ensureCsrfToken();

  const headers = {
    "content-type": "application/json",
    Origin: "http://localhost:3000",
    "x-csrf-token": csrfToken,
  };

  if (cookie) {
    headers.Cookie = withCookies(cookie);
  } else {
    headers.Cookie = csrfCookie;
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

async function requestJsonWithCsrfHeader(path, method, body, cookie, csrfHeader) {
  await ensureCsrfToken();

  const headers = {
    "content-type": "application/json",
    Origin: "http://localhost:3000",
    "x-csrf-token": csrfHeader,
    Cookie: withCookies(cookie),
  };
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

async function requestJsonWithoutCsrf(path, method, body, cookie) {
  await ensureCsrfToken();

  const headers = {
    "content-type": "application/json",
    Origin: "http://localhost:3000",
    Cookie: withCookies(cookie),
  };
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

async function requestGraphQL(query, cookie, queryString = "", extraHeaders = {}, variables) {
  await ensureCsrfToken();

  const headers = {
    "content-type": "application/json",
    Origin: "http://localhost:3000",
    "x-csrf-token": csrfToken,
    ...extraHeaders,
  };

  if (cookie) {
    headers.Cookie = withCookies(cookie);
  } else {
    headers.Cookie = csrfCookie;
  }

  const response = await fetch(`${BASE_URL}/graphql${queryString}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
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
  let guestCookie = null;

  try {
    const preflight = await fetch(`${BASE_URL}/auth/register`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, x-csrf-token",
      },
    });

    assert(preflight.status === 204, `Auth preflight returned ${preflight.status}`);

    const registered = await requestJson("/auth/register", "POST", {
      name: "Auth Smoke",
      email,
      password,
    });

    assert(registered.response.status === 202, "Registration failed");
    assert(
      registered.payload.message ===
        "If this email can be registered, verification instructions will be sent.",
      "Registration response is not generic"
    );
    const registrationCookieHeader = registered.response.headers.get("set-cookie");
    assert(Boolean(registrationCookieHeader), "Registration did not start an account session");
    const registrationCookie = registrationCookieHeader.split(";")[0];

    const registrationSession = await requestJson("/auth/session", "GET", null, registrationCookie);
    assert(registrationSession.response.status === 200, "Registration session lookup failed");
    assert(registrationSession.payload.user.email === email, "Registration session returned the wrong user");
    assert(registrationSession.payload.user.emailVerified === false, "New registration was unexpectedly verified");

    const registrationBoards = await requestGraphQL("{ listBoards { id } }", registrationCookie);
    assert(
      !registrationBoards.payload.errors && registrationBoards.payload.data?.listBoards?.length > 0,
      `New unverified account could not access the workspace: ${JSON.stringify(registrationBoards.payload)}`
    );

    const duplicateRegistration = await requestJson("/auth/register", "POST", {
      name: "Another Auth Smoke",
      email,
      password: "different-password-456",
    });
    assert(duplicateRegistration.response.status === 409, "Duplicate registration was not rejected");
    assert(
      duplicateRegistration.payload.error ===
        "An account with this email already exists. Please sign in instead.",
      "Duplicate registration returned the wrong message"
    );
    assert(!duplicateRegistration.response.headers.get("set-cookie"), "Duplicate registration started a session");

    const firstLogin = await requestJson("/auth/login", "POST", { email, password });
    assert(firstLogin.response.status === 200, "Login after registration failed");
    const registerCookieHeader = firstLogin.response.headers.get("set-cookie");
    assert(Boolean(registerCookieHeader), "Login did not set a session cookie");
    assert(registerCookieHeader.includes("HttpOnly"), "Session cookie is not HttpOnly");
    assert(registerCookieHeader.includes("SameSite=Lax"), "Session cookie has the wrong SameSite policy");
    assert(registerCookieHeader.includes("Path=/"), "Session cookie has no root path");

    const registerCookie = registerCookieHeader.split(";")[0];
    userId = firstLogin.payload.user.id;

    assert(firstLogin.payload.user.emailVerified === false, "New account should require email verification");

    const currentSession = await requestJson("/auth/session", "GET", null, registerCookie);
    assert(currentSession.response.status === 200, "Current session lookup failed");
    assert(currentSession.payload.user.email === email, "Current session returned the wrong user");
    assert(
      currentSession.response.headers.get("cache-control")?.includes("no-store"),
      "Session response is cacheable"
    );

    const missingCsrfLogout = await requestJsonWithoutCsrf(
      "/auth/logout",
      "POST",
      null,
      registerCookie
    );
    assert(missingCsrfLogout.response.status === 403, "Missing CSRF token was accepted");

    const invalidCsrfLogout = await requestJsonWithCsrfHeader(
      "/auth/logout",
      "POST",
      null,
      registerCookie,
      "invalid-csrf-token"
    );
    assert(invalidCsrfLogout.response.status === 403, "Invalid CSRF token was accepted");

    const unverifiedBoards = await requestGraphQL(
      "{ listBoards { id } }",
      registerCookie
    );
    assert(
      !unverifiedBoards.payload.errors,
      `Unverified account could not access private workspace: ${JSON.stringify(unverifiedBoards.payload)}`
    );
    assert(unverifiedBoards.payload.data?.listBoards?.length > 0, "Unverified account has no private board");

    const boardId = unverifiedBoards.payload.data.listBoards[0].id;
    const unverifiedNote = await requestGraphQL(
      `
      mutation CreatePrivateNote($boardId: ID!) {
        createNote(boardId: $boardId, title: "Private note", content: "Created before verification") { id }
      }
      `,
      registerCookie,
      "",
      {},
      { boardId }
    );
    assert(
      !unverifiedNote.payload.errors && unverifiedNote.payload.data?.createNote?.id,
      `Unverified account could not create a private note: ${JSON.stringify(unverifiedNote.payload)}`
    );

    const unverifiedCollaborators = await requestGraphQL(
      `query($boardId: ID!) { listBoardCollaborators(boardId: $boardId) { email } }`,
      registerCookie,
      "",
      {},
      { boardId }
    );
    assert(
      unverifiedCollaborators.payload.data?.listBoardCollaborators == null &&
        unverifiedCollaborators.payload.errors?.some(
          (error) => error.extensions?.code === "EMAIL_VERIFICATION_REQUIRED"
        ),
      "Unverified account could manage collaborators"
    );

    const unverifiedShare = await requestGraphQL(
      `
      mutation CreateShareLink($boardId: ID!, $permission: BoardPermission!) {
        createShareLink(boardId: $boardId, permission: $permission)
      }
      `,
      registerCookie,
      "",
      {},
      { boardId, permission: "view" }
    );
    assert(
      unverifiedShare.payload.data?.createShareLink == null &&
        unverifiedShare.payload.errors?.some(
        (error) => error.extensions?.code === "EMAIL_VERIFICATION_REQUIRED"
        ),
      "Unverified account could create a share link"
    );

    await pool.query("UPDATE users SET email_verified_at = NOW() WHERE id = $1", [userId]);

    const forgedIdentity = await requestGraphQL(
      "{ listBoards { id } }",
      null,
      `?sessionId=${encodeURIComponent(userId)}&userEmail=${encodeURIComponent(email)}`,
      { "x-session-id": String(userId), "x-user-email": email }
    );
    assert(
      forgedIdentity.payload.data?.listBoards == null,
      "Client-controlled identity values authenticated a GraphQL request"
    );
    assert(
      forgedIdentity.payload.errors?.length > 0,
      "GraphQL did not require a validated session cookie"
    );

    const boards = await requestGraphQL(
      "{ listBoards { id ownerId name shareLinkActive sharePermission } }",
      registerCookie
    );
    assert(!boards.payload.errors, `Authenticated GraphQL query failed: ${JSON.stringify(boards.payload)}`);
    assert(boards.payload.data.listBoards.length > 0, "Account did not receive an initial board");
    assert(String(boards.payload.data.listBoards[0].ownerId) === String(userId), "Board ownership is not typed to the user");

    assert(boards.payload.data.listBoards[0].shareLinkActive === false, "New board has an active share link");

    const viewShare = await requestGraphQL(
      `
      mutation CreateShareLink($boardId: ID!, $permission: BoardPermission!) {
        createShareLink(boardId: $boardId, permission: $permission)
      }
      `,
      registerCookie,
      "",
      {},
      { boardId, permission: "view" }
    );
    const viewToken = viewShare.payload.data?.createShareLink;
    assert(!viewShare.payload.errors, `View share-link creation failed: ${JSON.stringify(viewShare.payload)}`);
    assert(typeof viewToken === "string" && viewToken.length >= 40, "Share token has insufficient entropy");

    const boardColumns = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'boards'
        AND column_name IN ('share_token', 'share_token_hash')
      `
    );
    const columnNames = new Set(boardColumns.rows.map((row) => row.column_name));
    assert(!columnNames.has("share_token"), "Plaintext share-token column still exists");
    assert(columnNames.has("share_token_hash"), "Hashed share-token column is missing");

    const storedShareToken = await pool.query(
      "SELECT share_token_hash FROM boards WHERE id = $1",
      [boardId]
    );
    const storedShareTokenHash = storedShareToken.rows[0]?.share_token_hash;
    assert(
      typeof storedShareTokenHash === "string" &&
        storedShareTokenHash.length === 64 &&
        storedShareTokenHash !== viewToken,
      "Share token was not stored as a SHA-256 hash"
    );

    const guestSession = await requestJson("/auth/guest-session", "POST");
    const guestCookieHeader = guestSession.response.headers.get("set-cookie");
    assert(Boolean(guestCookieHeader), "Guest session did not set a cookie");
    guestCookie = guestCookieHeader.split(";")[0];

    const viewAccess = await requestGraphQL(
      `
      query AccessSharedBoard($token: String!) {
        accessSharedBoard(token: $token) {
          permission
          board { id shareLinkActive sharePermission }
        }
      }
      `,
      guestCookie,
      "",
      {},
      { token: viewToken }
    );
    const viewAccessResult = viewAccess.payload.data?.accessSharedBoard;
    assert(!viewAccess.payload.errors, `View shared-board access failed: ${JSON.stringify(viewAccess.payload)}`);
    assert(viewAccessResult?.permission === "view", "View share link granted the wrong permission");

    const viewCreateNote = await requestGraphQL(
      `
      mutation CreateSharedNote($boardId: ID!, $shareToken: String!) {
        createNote(boardId: $boardId, shareToken: $shareToken, title: "Blocked", content: "Blocked") { id }
      }
      `,
      guestCookie,
      "",
      {},
      { boardId, shareToken: viewToken }
    );
    assert(
      viewCreateNote.payload.data?.createNote == null && viewCreateNote.payload.errors?.length > 0,
      "View share link allowed note editing"
    );

    const editShare = await requestGraphQL(
      `
      mutation CreateShareLink($boardId: ID!, $permission: BoardPermission!) {
        createShareLink(boardId: $boardId, permission: $permission)
      }
      `,
      registerCookie,
      "",
      {},
      { boardId, permission: "edit" }
    );
    const editToken = editShare.payload.data?.createShareLink;
    assert(!editShare.payload.errors, `Edit share-link creation failed: ${JSON.stringify(editShare.payload)}`);
    assert(editToken !== viewToken, "Share-link regeneration reused the previous token");

    const oldTokenAccess = await requestGraphQL(
      `query($token: String!) { accessSharedBoard(token: $token) { permission } }`,
      guestCookie,
      "",
      {},
      { token: viewToken }
    );
    assert(
      oldTokenAccess.payload.data?.accessSharedBoard == null && oldTokenAccess.payload.errors?.length > 0,
      "Regenerating a share link did not revoke the previous token"
    );

    const editAccess = await requestGraphQL(
      `query($token: String!) { accessSharedBoard(token: $token) { permission } }`,
      guestCookie,
      "",
      {},
      { token: editToken }
    );
    assert(!editAccess.payload.errors, `Regenerated shared-board access failed: ${JSON.stringify(editAccess.payload)}`);
    assert(
      editAccess.payload.data?.accessSharedBoard?.permission === "edit",
      "Edit share link did not grant edit permission"
    );

    const revokeShare = await requestGraphQL(
      `mutation RevokeShareLink($boardId: ID!) { revokeShareLink(boardId: $boardId) }`,
      registerCookie,
      "",
      {},
      { boardId }
    );
    assert(revokeShare.payload.data?.revokeShareLink === true, "Share-link revocation failed");

    const revokedAccess = await requestGraphQL(
      `query($token: String!) { accessSharedBoard(token: $token) { permission } }`,
      guestCookie,
      "",
      {},
      { token: editToken }
    );
    assert(
      revokedAccess.payload.data?.accessSharedBoard == null && revokedAccess.payload.errors?.length > 0,
      "Revoked share link remained usable"
    );

    const revokedBoard = await pool.query(
      "SELECT share_token_hash FROM boards WHERE id = $1",
      [boardId]
    );
    assert(revokedBoard.rows[0]?.share_token_hash === null, "Revocation did not clear the stored token hash");

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
    const passwordChangeCookie = loginCookieHeader.split(";")[0];
    const changedPassword = "changed-password-789";
    const passwordChange = await requestJson(
      "/auth/password/change",
      "POST",
      { currentPassword: password, newPassword: changedPassword },
      passwordChangeCookie
    );
    assert(passwordChange.response.status === 200, "Authenticated password change failed");
    assert(passwordChange.payload.passwordChanged === true, "Password change response was invalid");
    const revokedChangedSession = await requestJson("/auth/session", "GET", null, passwordChangeCookie);
    assert(revokedChangedSession.response.status === 401, "Password change did not revoke the active session");

    const changedLogin = await requestJson("/auth/login", "POST", {
      email,
      password: changedPassword,
    });
    assert(changedLogin.response.status === 200, "New password could not log in");

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
    assert(
      wrongLogin.payload.error === "The credentials do not match.",
      "Invalid login exposed credential details"
    );

    const missingPasswordLogin = await requestJson("/auth/login", "POST", { email });
    assert(missingPasswordLogin.response.status === 401, "Missing password did not use generic login failure");
    assert(
      missingPasswordLogin.payload.error === "The credentials do not match.",
      "Missing password exposed validation details"
    );

    const shortPasswordLogin = await requestJson("/auth/login", "POST", {
      email,
      password: "short",
    });
    assert(shortPasswordLogin.response.status === 401, "Short password did not use generic login failure");
    assert(
      shortPasswordLogin.payload.error === "The credentials do not match.",
      "Short password exposed password policy details"
    );

    const rateLimitedEmail = `auth-rate-limit-${Date.now()}@example.com`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failedLogin = await requestJson("/auth/login", "POST", {
        email: rateLimitedEmail,
        password: "wrong-password",
      });
      assert(failedLogin.response.status === 401, "Rate-limit setup login unexpectedly succeeded");
    }

    const rateLimitedLogin = await requestJson("/auth/login", "POST", {
      email: rateLimitedEmail,
      password: "wrong-password",
    });
    assert(rateLimitedLogin.response.status === 429, "Login rate limit did not trigger");
    assert(
      Number(rateLimitedLogin.response.headers.get("retry-after")) > 0,
      "Rate-limited login did not include Retry-After"
    );

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
          passwordChangeStatus: passwordChange.response.status,
          wrongLoginStatus: wrongLogin.response.status,
        },
        null,
        2
      )
    );
  } finally {
    if (guestCookie) {
      await requestJson("/auth/guest-session", "DELETE", null, guestCookie).catch(() => undefined);
    }

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