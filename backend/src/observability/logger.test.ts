import assert from "node:assert/strict";
import test from "node:test";
import { redactSensitiveText, redactShareToken, sanitizeLogValue } from "./logger.js";

test("redacts share tokens while preserving safe boolean status fields", () => {
  const sanitized = sanitizeLogValue({
    shareToken: "share-secret",
    shareTokenPresent: true,
    tokenRedacted: true,
    unsafeStatusValue: "secret",
  }) as Record<string, unknown>;

  assert.equal(redactShareToken("share-secret"), "[REDACTED]");
  assert.equal(redactShareToken(null), null);
  assert.equal(sanitized.shareToken, "[REDACTED]");
  assert.equal(sanitized.shareTokenPresent, true);
  assert.equal(sanitized.tokenRedacted, true);
});

test("redacts share and action tokens from URLs", () => {
  const value = "https://app.example.com/workspace#share=share-secret&token=action-secret";

  assert.equal(
    redactSensitiveText(value),
    "https://app.example.com/workspace#share=[REDACTED]&token=[REDACTED]"
  );
});

test("redacts subscription tickets from URLs and log fields", () => {
  const value = "https://api.example.com/graphql?ticket=ticket-secret&query=subscription";
  const sanitized = sanitizeLogValue({ ticket: "ticket-secret" }) as Record<string, unknown>;

  assert.equal(
    redactSensitiveText(value),
    "https://api.example.com/graphql?ticket=[REDACTED]&query=subscription"
  );
  assert.equal(sanitized.ticket, "[REDACTED]");
});

test("redacts sensitive log fields and error text", () => {
  const sanitized = sanitizeLogValue({
    cookie: "synapse_auth_session=secret",
    authorization: "Bearer secret",
    csrfToken: "csrf-secret",
    sessionId: "session-secret",
    nested: { shareToken: "share-secret" },
    message: "Request failed at https://api.example.com/graphql?shareToken=share-secret",
  }) as Record<string, unknown>;

  assert.equal(sanitized.cookie, "[REDACTED]");
  assert.equal(sanitized.authorization, "[REDACTED]");
  assert.equal(sanitized.csrfToken, "[REDACTED]");
  assert.equal(sanitized.sessionId, "[REDACTED]");
  assert.deepEqual(sanitized.nested, { shareToken: "[REDACTED]" });
  assert.equal(
    sanitized.message,
    "Request failed at https://api.example.com/graphql?shareToken=[REDACTED]"
  );
});