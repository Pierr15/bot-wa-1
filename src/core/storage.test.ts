import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getFreeDiskBytes } from './storage.js';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('getFreeDiskBytes', () => {
  it('reports free space for an existing directory', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bot-storage-'));
    const free = await getFreeDiskBytes(tempDir);

    expect(free).not.toBeNull();
    expect(free).toBeGreaterThan(0);
  });

  it('returns null when the directory cannot be inspected', async () => {
    await expect(
      getFreeDiskBytes(path.join(os.tmpdir(), 'bot-missing-dir-for-statfs')),
    ).resolves.toBeNull();
  });
});
