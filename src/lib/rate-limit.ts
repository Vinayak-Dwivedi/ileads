import "server-only";
import { getConfig } from "@/lib/config";

// Process-local rate limiter. Sufficient for a single Node instance; replace
// with a Redis-backed implementation in Phase 2 once we run >1 worker.
interface Bucket {
  count: number;
  firstAt: number;
}

const loginBuckets = new Map<string, Bucket>();

function pruneIfStale(bucket: Bucket, windowMs: number, now: number): boolean {
  if (now - bucket.firstAt >= windowMs) {
    bucket.count = 0;
    bucket.firstAt = now;
    return true;
  }
  return false;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkLoginRateLimit(key: string): RateLimitResult {
  const { AUTH_RATE_LIMIT_MAX: max, AUTH_RATE_LIMIT_WINDOW_MS: windowMs } = getConfig();
  const now = Date.now();
  const bucket = loginBuckets.get(key) ?? { count: 0, firstAt: now };
  pruneIfStale(bucket, windowMs, now);
  loginBuckets.set(key, bucket);

  if (bucket.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, bucket.firstAt + windowMs - now),
    };
  }
  return { allowed: true, remaining: max - bucket.count, retryAfterMs: 0 };
}

export function recordLoginFailure(key: string): void {
  const { AUTH_RATE_LIMIT_WINDOW_MS: windowMs } = getConfig();
  const now = Date.now();
  const bucket = loginBuckets.get(key) ?? { count: 0, firstAt: now };
  pruneIfStale(bucket, windowMs, now);
  bucket.count += 1;
  loginBuckets.set(key, bucket);
}

export function resetLoginRateLimit(key: string): void {
  loginBuckets.delete(key);
}
