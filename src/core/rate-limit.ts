/**
 * Sliding-window limiter used to protect the downloader from spam.
 * Keeps only timestamps inside the active window.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  take(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
    const timestamp = this.now();
    const recent = (this.hits.get(key) ?? []).filter((hit) => timestamp - hit < windowMs);

    if (recent.length >= limit) {
      const oldest = recent[0] ?? timestamp;
      this.hits.set(key, recent);
      return {
        allowed: false,
        retryAfterMs: Math.max(0, windowMs - (timestamp - oldest)),
      };
    }

    recent.push(timestamp);
    this.hits.set(key, recent);
    this.sweep(timestamp, windowMs);

    return { allowed: true, retryAfterMs: 0 };
  }

  private sweep(timestamp: number, windowMs: number): void {
    if (this.hits.size < 1_000) {
      return;
    }

    for (const [key, hits] of this.hits) {
      const recent = hits.filter((hit) => timestamp - hit < windowMs);

      if (recent.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, recent);
      }
    }
  }
}
