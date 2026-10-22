import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { ConfigError } from './core/errors.js';

describe('loadConfig', () => {
  it('normalizes owner numbers and resolves paths', () => {
    const config = loadConfig({
      OWNER_NUMBERS: '0812-3456-7890, +62 813 0000 1111',
    });

    expect(config.ownerNumbers).toEqual(['6281234567890', '6281300001111']);
    expect(config.paths.tmpDir).toBe(path.resolve('data/tmp'));
    expect(config.paths.cookiesDir).toBe(path.resolve('data/cookies'));
    expect(config.sticker.defaultPosition).toBe('bottom');
    expect(config.download.maxBytes).toBe(16 * 1024 * 1024);
    expect(config.download.minFreeDiskBytes).toBe(1024 * 1024 * 1024);
    expect(config.download.tikwmFallback).toBe(true);
  });

  it('rejects pairing mode without a bot phone number', () => {
    expect(() =>
      loadConfig({
        LOGIN_MODE: 'pairing',
      }),
    ).toThrow(ConfigError);
  });

  it('normalizes the pairing phone number', () => {
    const config = loadConfig({
      LOGIN_MODE: 'pairing',
      BOT_PHONE_NUMBER: '0812 3456 7890',
      OWNER_NUMBERS: '0813 0000 1111',
    });

    expect(config.botPhoneNumber).toBe('6281234567890');
  });
});
