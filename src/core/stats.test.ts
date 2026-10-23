import { describe, expect, it } from 'vitest';
import { StatsCollector } from './stats.js';

describe('StatsCollector', () => {
  it('records counters and merges into a snapshot', () => {
    const collector = new StatsCollector();
    collector.record('stiker');
    collector.record('stiker');
    collector.record('stiker_gagal', 3);
    collector.record('cmd_s', 2);

    const snapshot = collector.snapshot();

    expect(snapshot).toEqual({
      cmd_s: 2,
      stiker: 2,
      stiker_gagal: 3,
    });
  });

  it('supports deltas and resets', () => {
    const collector = new StatsCollector();
    collector.record('download', 5);
    collector.record('download', -2);
    expect(collector.snapshot()).toEqual({ download: 3 });

    collector.reset();
    expect(collector.snapshot()).toEqual({});
  });
});
