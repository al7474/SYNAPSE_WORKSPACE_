import crypto from "node:crypto";

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): RateLimitDecision;
  reset(key: string): void;
  purgeExpired(): void;
}

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export function createRateLimitKey(scope: string, value: string): string {
  const digest = crypto.createHash("sha256").update(value).digest("hex");
  return `${scope}:${digest}`;
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

  check(key: string, limit: number, windowMs: number): RateLimitDecision {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Rate limiter limit must be a positive integer");
    }

    if (!Number.isInteger(windowMs) || windowMs < 1) {
      throw new Error("Rate limiter window must be a positive integer");
    }

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

  reset(key: string): void {
    this.buckets.delete(key);
  }

  purgeExpired(): void {
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