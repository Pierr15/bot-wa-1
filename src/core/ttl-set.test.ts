import { describe, expect, it } from 'vitest';
import { TtlSet } from './ttl-set.js';

describe('TtlSet', () => {
  it('rejects duplicates within the TTL', () => {
    const now = 1_000;
    const set = new TtlSet(5_000, () => now);

    expect(set.add('message-1')).toBe(true);
    expect(set.add('message-1')).toBe(false);
    expect(set.has('message-1')).toBe(true);
  });

  it('accepts the same key after expiry', () => {
    let now = 1_000;
    const set = new TtlSet(5_000, () => now);

    expect(set.add('message-1')).toBe(true);
    now += 5_001;
    expect(set.has('message-1')).toBe(false);
    expect(set.add('message-1')).toBe(true);
  });
});
