import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import type { AppLogger } from './logger.js';

export async function ensureDirectories(config: AppConfig): Promise<void> {
  await Promise.all([
    mkdir(config.paths.dataDir, { recursive: true }),
    mkdir(config.paths.authDir, { recursive: true }),
    mkdir(config.paths.tmpDir, { recursive: true }),
    mkdir(config.paths.cookiesDir, { recursive: true }),
  ]);
}

export async function cleanupTempFiles(tmpDir: string, maxAgeMs: number): Promise<number> {
  let entries;

  try {
    entries = await readdir(tmpDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  const now = Date.now();
  let removed = 0;

  for (const entry of entries) {
    const target = path.join(tmpDir, entry.name);

    try {
      const info = await stat(target);
      if (now - info.mtimeMs < maxAgeMs) {
        continue;
      }

      await rm(target, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      });
      removed += 1;
    } catch {
      // File can be locked by ffmpeg/yt-dlp on Android. The next sweep retries it.
    }
  }

  return removed;
}

export function startTempCleanup(
  logger: AppLogger,
  tmpDir: string,
  intervalMs = 15 * 60_000,
  maxAgeMs = 6 * 60 * 60_000,
): NodeJS.Timeout {
  const run = async (): Promise<void> => {
    try {
      const removed = await cleanupTempFiles(tmpDir, maxAgeMs);
      if (removed > 0) {
        logger.info({ removed }, 'File temp dibersihkan');
      }
    } catch (error) {
      logger.warn({ err: error }, 'Gagal membersihkan file temp');
    }
  };

  void run();

  const timer = setInterval(() => {
    void run();
  }, intervalMs);

  timer.unref();
  return timer;
}
