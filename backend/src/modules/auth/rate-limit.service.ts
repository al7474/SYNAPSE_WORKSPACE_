import crypto from "node:crypto";
import { Redis } from "@upstash/redis";

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitDecision>;
  reset(key: string): Promise<void>;
  purgeExpired(): Promise<void>;
}

export class RateLimitUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Rate limiter is unavailable", { cause });
    this.name = "RateLimitUnavailableError";
  }
}

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export function createRateLimitKey(scope: string, value: string): string {
  const digest = crypto.createHash("sha256").update(value).digest("hex");
  return `${scope}:${digest}`;
}

function validateRateLimitParameters(limit: number, windowMs: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Rate limiter limit must be a positive integer");
  }

  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error("Rate limiter window must be a positive integer");
  }
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly maxKeys = 10_000,
    private readonly clock: () => number = Date.now
  ) {
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new Error("Rate limiter maxKeys must be a positive integer");
    }
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    validateRateLimitParameters(limit, windowMs);

    const now = this.clock();
    const current = this.buckets.get(key);

    if (!current || current.resetAt <= now) {
      this.ensureCapacity(now);
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
      };
    }

    if (current.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }

    current.count += 1;

    return {
      allowed: true,
      remaining: Math.max(0, limit - current.count),
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  async purgeExpired(): Promise<void> {
    const now = this.clock();
    this.ensureCapacity(now);
  }

  private ensureCapacity(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }

    while (this.buckets.size >= this.maxKeys) {
      const oldestKey = this.buckets.keys().next().value;

      if (oldestKey === undefined) {
        break;
      }

      this.buckets.delete(oldestKey);
    }
  }
}

const ATOMIC_RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local remaining = redis.call("PTTL", KEYS[1])
return { count, remaining }
`;

type RateLimitScript = {
  exec(keys: string[], args: string[]): Promise<[number, number]>;
};

export class UpstashRateLimiter implements RateLimiter {
  private readonly script: RateLimitScript;

  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix = "synapse:auth:ratelimit:"
  ) {
    this.script = redis.createScript<[number, number]>(ATOMIC_RATE_LIMIT_SCRIPT);
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    validateRateLimitParameters(limit, windowMs);

    try {
      const [count, ttlMs] = await this.script.exec(
        [this.getRedisKey(key)],
        [String(windowMs)]
      );
      const retryAfterSeconds = Math.max(1, Math.ceil(Math.max(0, ttlMs) / 1000));

      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds,
      };
    } catch (error) {
      throw new RateLimitUnavailableError(error);
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.redis.del(this.getRedisKey(key));
    } catch (error) {
      throw new RateLimitUnavailableError(error);
    }
  }

  async purgeExpired(): Promise<void> {}

  private getRedisKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}