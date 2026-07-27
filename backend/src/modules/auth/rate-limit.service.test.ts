import assert from "node:assert/strict";
import test from "node:test";
import type { Redis } from "@upstash/redis";
import {
  createRateLimitKey,
  InMemoryRateLimiter,
  RateLimitUnavailableError,
  UpstashRateLimiter,
} from "./rate-limit.service.js";

test("allows up to the configured limit and returns a retry window", async () => {
  let currentTime = 1_000;
  const limiter = new InMemoryRateLimiter(10, () => currentTime);
  const key = createRateLimitKey("login", "person@example.com");

  assert.equal((await limiter.check(key, 2, 1_000)).allowed, true);
  assert.equal((await limiter.check(key, 2, 1_000)).allowed, true);

  const blocked = await limiter.check(key, 2, 1_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterSeconds, 1);

  currentTime += 1_000;
  assert.equal((await limiter.check(key, 2, 1_000)).allowed, true);
});

test("reset clears a bucket and capacity stays bounded", async () => {
  const limiter = new InMemoryRateLimiter(1);
  const firstKey = createRateLimitKey("login", "first@example.com");
  const secondKey = createRateLimitKey("login", "second@example.com");

  assert.equal((await limiter.check(firstKey, 1, 60_000)).allowed, true);
  await limiter.reset(firstKey);
  assert.equal((await limiter.check(firstKey, 1, 60_000)).allowed, true);
  assert.equal((await limiter.check(secondKey, 1, 60_000)).allowed, true);
});

test("upstash adapter maps atomic results and reset behavior", async () => {
  let count = 0;
  const redis = {
    createScript: () => ({
      exec: async () => {
        count += 1;
        return [count, 900] as [number, number];
      },
    }),
    del: async () => {
      count = 0;
      return 1;
    },
  } as unknown as Redis;
  const limiter = new UpstashRateLimiter(redis);
  const key = createRateLimitKey("login", "person@example.com");

  assert.deepEqual(await limiter.check(key, 2, 1_000), {
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(await limiter.check(key, 2, 1_000), {
    allowed: true,
    remaining: 0,
    retryAfterSeconds: 1,
  });
  assert.equal((await limiter.check(key, 2, 1_000)).allowed, false);

  await limiter.reset(key);
  assert.equal((await limiter.check(key, 2, 1_000)).allowed, true);
});

test("upstash adapter fails closed when Redis is unavailable", async () => {
  const redis = {
    createScript: () => ({
      exec: async () => {
        throw new Error("Redis is offline");
      },
    }),
    del: async () => 1,
  } as unknown as Redis;
  const limiter = new UpstashRateLimiter(redis);
  const key = createRateLimitKey("login", "person@example.com");

  await assert.rejects(
    limiter.check(key, 1, 1_000),
    (error: unknown) => error instanceof RateLimitUnavailableError
  );
});