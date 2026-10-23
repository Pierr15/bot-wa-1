export class StatsCollector {
  private readonly counters = new Map<string, number>();

  record(key: string, delta = 1): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + delta);
  }

  snapshot(): Record<string, number> {
    const result: Record<string, number> = {};

    for (const [key, value] of [...this.counters.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], 'id'),
    )) {
      result[key] = value;
    }

    return result;
  }

  reset(): void {
    this.counters.clear();
  }
}

/** Shared process-wide collector; handlers record into this instance. */
export const stats = new StatsCollector();
