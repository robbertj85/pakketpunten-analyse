// Simple in-memory sliding-window rate limiter.
//
// State lives in module scope, so it is per server instance. On a single
// long-running Node server (or in dev) this is exact. On multi-instance /
// serverless deploys (e.g. Vercel) each instance keeps its own window, so the
// effective global limit is "max × instances" — still a meaningful throttle,
// but to enforce a strict global cap back this with a shared store (Upstash
// Redis / Vercel KV) keyed the same way.

export interface RateLimitResult {
  ok: boolean;
  /** Remaining events allowed in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the caller may retry (0 when ok). */
  retryAfterSec: number;
}

const buckets = new Map<string, number[]>();
let lastSweep = 0;

/**
 * Sliding-window limiter. Allows up to `max` events per `windowMs` per `key`.
 * When the window is full the call is rejected and `retryAfterSec` is the time
 * until the oldest event ages out (i.e. the cooldown).
 */
export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  // Opportunistic cleanup of stale keys (at most once per window).
  if (now - lastSweep > windowMs) {
    for (const [k, times] of buckets) {
      if (times.length === 0 || now - times[times.length - 1] > windowMs) {
        buckets.delete(k);
      }
    }
    lastSweep = now;
  }

  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= max) {
    buckets.set(key, recent);
    const retryAfterSec = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSec };
  }

  recent.push(now);
  buckets.set(key, recent);
  return { ok: true, remaining: max - recent.length, retryAfterSec: 0 };
}
