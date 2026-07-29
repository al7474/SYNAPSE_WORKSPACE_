import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import test from "node:test";
import {
  clearAuthSessionCookie,
  handleAuthRequest,
  serializeAuthSessionCookie,
  type AuthHttpDependencies,
} from "./auth-http.js";

class MockServerResponse {
  statusCode = 0;
  body = "";
  headers = new Map<string, string>();

  setHeader(name: string, value: string): this {
    this.headers.set(name, value);
    return this;
  }

  end(body?: string): void {
    this.body = body || "";
  }
}

test("uses cross-site session cookie attributes in production", () => {
  const sessionCookie = serializeAuthSessionCookie("session-token", 3600, true);
  const clearedCookie = clearAuthSessionCookie(true);

  assert.match(sessionCookie, /SameSite=None/);
  assert.match(sessionCookie, /; Secure/);
  assert.match(clearedCookie, /SameSite=None/);
  assert.match(clearedCookie, /; Secure/);
});

test("keeps local session cookies same-site", () => {
  const sessionCookie = serializeAuthSessionCookie("session-token", 3600, false);
  const clearedCookie = clearAuthSessionCookie(false);

  assert.match(sessionCookie, /SameSite=Lax/);
  assert.doesNotMatch(sessionCookie, /; Secure/);
  assert.match(clearedCookie, /SameSite=Lax/);
  assert.doesNotMatch(clearedCookie, /; Secure/);
});

test("rejects duplicate registration with a conflict response", async () => {
  const response = new MockServerResponse();
  const dependencies = {
    authService: { register: async () => null },
    emailService: {},
    isProduction: false,
    rateLimiter: {},
    rateLimitEnabled: false,
    clientIp: "127.0.0.1",
    maxBodyBytes: 16_384,
    csrfEnabled: false,
  } as unknown as AuthHttpDependencies;

  await handleAuthRequest(
    new Request("http://localhost:4000/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Existing User",
        email: "existing@example.com",
        password: "correct-horse-123",
      }),
    }),
    response as unknown as ServerResponse,
    dependencies
  );

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), {
    error: "An account with this email already exists. Please sign in instead.",
  });
});