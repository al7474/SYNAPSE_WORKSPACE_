import assert from "node:assert/strict";
import test from "node:test";
import { clearAuthSessionCookie, serializeAuthSessionCookie } from "./auth-http.js";

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