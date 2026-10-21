import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.js';

describe('RateLimiter', () => {
  it('allows hits under the limit', () => {
    let now = 1_000;
    const limiter = new RateLimiter(() => now);

    expect(limiter.take('user', 3, 5_000).allowed).toBe(true);
    now += 100;
    expect(limiter.take('user', 3, 5_000).allowed).toBe(true);
    now += 100;
    expect(limiter.take('user', 3, 5_000).allowed).toBe(true);
  });

  it('blocks over the limit and reports retry time', () => {
    let now = 1_000;
    const limiter = new RateLimiter(() => now);

    limiter.take('user', 2, 5_000);
    now += 1_000;
    limiter.take('user', 2, 5_000);

    const result = limiter.take('user', 2, 5_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(4_000);
  });

  it('allows again after the window expires', () => {
    let now = 1_000;
    const limiter = new RateLimiter(() => now);

    limiter.take('user', 1, 5_000);
    now += 5_001;

    expect(limiter.take('user', 1, 5_000).allowed).toBe(true);
  });

  it('keeps limits separate per key', () => {
    const now = 1_000;
    const limiter = new RateLimiter(() => now);

    limiter.take('a', 1, 5_000);
    expect(limiter.take('b', 1, 5_000).allowed).toBe(true);
  });
});
