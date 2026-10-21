/**
 * A small in-memory set with per-entry TTL, used to ignore duplicate
 * WhatsApp messages that can arrive again after a reconnect.
 */
export class TtlSet {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  add(key: string): boolean {
    const timestamp = this.now();
    this.sweep(timestamp);

    if (this.entries.has(key)) {
      return false;
    }

    this.entries.set(key, timestamp);
    return true;
  }

  has(key: string): boolean {
    const timestamp = this.now();
    const createdAt = this.entries.get(key);

    if (createdAt === undefined) {
      return false;
    }

    if (timestamp - createdAt >= this.ttlMs) {
      this.entries.delete(key);
      return false;
    }

    return true;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private sweep(timestamp: number): void {
    if (this.entries.size < 1_000) {
      return;
    }

    for (const [key, createdAt] of this.entries) {
      if (timestamp - createdAt >= this.ttlMs) {
        this.entries.delete(key);
      }
    }
  }
}
