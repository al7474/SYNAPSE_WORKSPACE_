import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimitKey, InMemoryRateLimiter } from "./rate-limit.service.js";

test("allows up to the configured limit and returns a retry window", () => {
  let currentTime = 1_000;
  const limiter = new InMemoryRateLimiter(10, () => currentTime);
  const key = createRateLimitKey("login", "person@example.com");

  assert.equal(limiter.check(key, 2, 1_000).allowed, true);
  assert.equal(limiter.check(key, 2, 1_000).allowed, true);

  const blocked = limiter.check(key, 2, 1_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterSeconds, 1);

  currentTime += 1_000;
  assert.equal(limiter.check(key, 2, 1_000).allowed, true);
});

test("reset clears a bucket and capacity stays bounded", () => {
  const limiter = new InMemoryRateLimiter(1);
  const firstKey = createRateLimitKey("login", "first@example.com");
  const secondKey = createRateLimitKey("login", "second@example.com");

  assert.equal(limiter.check(firstKey, 1, 60_000).allowed, true);
  limiter.reset(firstKey);
  assert.equal(limiter.check(firstKey, 1, 60_000).allowed, true);
  assert.equal(limiter.check(secondKey, 1, 60_000).allowed, true);
});