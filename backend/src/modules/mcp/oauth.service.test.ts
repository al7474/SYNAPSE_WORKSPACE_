import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  computeS256Challenge,
  isAllowedRedirectUri,
  isValidCodeVerifier,
  parseRequestedScopes,
} from "./oauth.service.js";
import { McpOAuthError } from "./oauth.types.js";

test("accepts loopback HTTP redirect URIs used by VS Code desktop", () => {
  assert.equal(isAllowedRedirectUri("http://127.0.0.1:33445/callback"), true);
  assert.equal(isAllowedRedirectUri("http://localhost:12345/"), true);
  assert.equal(isAllowedRedirectUri("http://[::1]:9000/callback"), true);
});

test("accepts the vscode.dev web redirect and vscode: deep link schemes", () => {
  assert.equal(isAllowedRedirectUri("https://vscode.dev/redirect"), true);
  assert.equal(isAllowedRedirectUri("https://insiders.vscode.dev/redirect?foo=bar"), true);
  assert.equal(isAllowedRedirectUri("vscode://vscode.github-authentication/callback"), true);
});

test("rejects redirect URIs pointing at arbitrary third-party hosts", () => {
  assert.equal(isAllowedRedirectUri("https://evil.example.com/callback"), false);
  assert.equal(isAllowedRedirectUri("http://192.168.1.5:8080/callback"), false);
  assert.equal(isAllowedRedirectUri("not a url"), false);
});

test("computeS256Challenge matches the RFC 7636 test vector", () => {
  const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(computeS256Challenge(codeVerifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("isValidCodeVerifier enforces the RFC 7636 character set and length", () => {
  assert.equal(isValidCodeVerifier(crypto.randomBytes(32).toString("base64url")), true);
  assert.equal(isValidCodeVerifier("too-short"), false);
  assert.equal(isValidCodeVerifier("has a space".repeat(5)), false);
});

test("parseRequestedScopes defaults to every known scope when omitted", () => {
  assert.deepEqual(parseRequestedScopes(undefined), [
    "boards:read",
    "notes:read",
    "notes:create",
    "notes:update",
  ]);
});

test("parseRequestedScopes narrows to the requested subset and deduplicates", () => {
  assert.deepEqual(parseRequestedScopes("notes:read notes:read boards:read"), [
    "notes:read",
    "boards:read",
  ]);
});

test("parseRequestedScopes rejects unknown scopes", () => {
  assert.throws(() => parseRequestedScopes("notes:delete"), McpOAuthError);
});
