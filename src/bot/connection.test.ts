import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotConnection } from './connection.js';
import type { AppConfig } from '../config.js';
import { createSilentLogger } from '../core/logger.js';

describe('BotConnection startup recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('schedules a reconnect when the initial connection setup throws', async () => {
    const config = {
      paths: { dataDir: '/tmp/bot-wa-connection-test' },
    } as AppConfig;
    const connection = new BotConnection(config, createSilentLogger(), async () => undefined);

    const internals = connection as unknown as {
      connect: () => Promise<void>;
      scheduleReconnect: () => void;
    };
    vi.spyOn(internals, 'connect').mockRejectedValueOnce(new Error('temporary network failure'));
    const scheduleReconnect = vi
      .spyOn(internals, 'scheduleReconnect')
      .mockImplementation(() => undefined);

    await expect(connection.start()).resolves.toBeUndefined();
    expect(scheduleReconnect).toHaveBeenCalledOnce();

    await connection.stop();
  });
});
