import "server-only";

// In-memory, per-process sliding window. This is correct for a single
// long-lived server instance; a multi-instance deployment would need a
// shared store (e.g. Upstash Redis) for the same guarantee across
// instances. Flagged here rather than silently pretended-away.
const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

  if (timestamps.length >= limit) {
    hits.set(key, timestamps);
    return false;
  }

  timestamps.push(now);
  hits.set(key, timestamps);
  return true;
}
