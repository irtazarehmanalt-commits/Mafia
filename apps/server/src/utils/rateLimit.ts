/**
 * A tiny in-process token bucket, keyed by "who + what".
 *
 * This guards against a single misbehaving client hammering the socket layer.
 * Cross-instance limiting would need Redis; for the per-socket abuse this is
 * meant to stop, in-process is both sufficient and much cheaper.
 */
interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitRule {
  /** Bucket capacity — the most a client may burst. */
  capacity: number;
  /** Tokens restored per second. */
  refillPerSecond: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(private readonly rules: Record<string, RateLimitRule>, private readonly fallback: RateLimitRule) {}

  /** Returns true when the action is allowed and consumes one token. */
  consume(key: string, action: string): boolean {
    const rule = this.rules[action] ?? this.fallback;
    const bucketKey = `${key}:${action}`;
    const now = Date.now();

    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = { tokens: rule.capacity, lastRefill: now };
      this.buckets.set(bucketKey, bucket);
    }

    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    if (elapsedSeconds > 0) {
      bucket.tokens = Math.min(rule.capacity, bucket.tokens + elapsedSeconds * rule.refillPerSecond);
      bucket.lastRefill = now;
    }

    this.maybeSweep(now);

    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Drop every bucket belonging to a key — called when a socket disconnects. */
  forget(key: string): void {
    for (const bucketKey of this.buckets.keys()) {
      if (bucketKey.startsWith(`${key}:`)) this.buckets.delete(bucketKey);
    }
  }

  /** Periodically evict buckets that have refilled completely. */
  private maybeSweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > 300_000) this.buckets.delete(key);
    }
  }
}

/** Per-socket limits, tuned so normal play never trips them. */
export const SOCKET_RATE_RULES: Record<string, RateLimitRule> = {
  'game:chat': { capacity: 8, refillPerSecond: 1 },
  'game:vote': { capacity: 10, refillPerSecond: 2 },
  'game:action': { capacity: 10, refillPerSecond: 2 },
  'room:join': { capacity: 5, refillPerSecond: 0.5 },
  'room:updateSettings': { capacity: 10, refillPerSecond: 2 },
  'ping:rtt': { capacity: 20, refillPerSecond: 4 },
};

export const SOCKET_RATE_FALLBACK: RateLimitRule = { capacity: 15, refillPerSecond: 3 };
