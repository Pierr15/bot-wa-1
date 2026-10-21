import { config as loadEnv } from 'dotenv';
import { BotConnection } from './bot/connection.js';
import { MessageRouter } from './bot/router.js';
import { loadConfig } from './config.js';
import { ConfigError } from './core/errors.js';
import { createLogger } from './core/logger.js';
import { ensureDirectories, startTempCleanup } from './core/storage.js';

loadEnv({ quiet: true });
process.env.TZ ??= 'Asia/Jakarta';

async function main(): Promise<void> {
  let config;

  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n${error.message}\n`);
      console.error('Salin .env.example menjadi .env lalu isi nilainya.');
      process.exitCode = 1;
      return;
    }

    throw error;
  }

  const logger = createLogger({
    level: config.logLevel,
    pretty: config.nodeEnv !== 'production',
  });

  await ensureDirectories(config);

  if (config.ownerNumbers.length === 0 && config.allowedNumbers.length === 0) {
    logger.warn(
      'OWNER_NUMBERS dan ALLOWED_NUMBERS kosong. Semua pesan akan diabaikan sampai whitelist diisi.',
    );
  }

  const cleanupTimer = startTempCleanup(logger, config.paths.tmpDir);

  const routerHolder: { current?: MessageRouter } = {};
  const connection = new BotConnection(config, logger, async (messages) => {
    await routerHolder.current?.handle(messages);
  });

  const router = new MessageRouter(config, logger, connection);
  routerHolder.current = router;

  logger.info('Memeriksa yt-dlp, ffmpeg, dan ffprobe');
  await router.initialize();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Menghentikan bot');
    clearInterval(cleanupTimer);
    routerHolder.current?.stop();
    await connection.stop();
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT').then(() => process.exit(0));
  });

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM').then(() => process.exit(0));
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception; proses akan dihentikan');
    setTimeout(() => process.exit(1), 500).unref();
  });

  logger.info(
    {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      loginMode: config.loginMode,
      owners: config.ownerNumbers.length,
      allowed: config.allowedNumbers.length,
      timezone: config.timezone,
    },
    `${config.botName} dimulai`,
  );

  await connection.start();
}

void main().catch((error: unknown) => {
  console.error('Gagal menjalankan bot:', error);
  process.exitCode = 1;
});
