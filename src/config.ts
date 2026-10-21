import path from 'node:path';
import { z } from 'zod';
import { ConfigError } from './core/errors.js';
import { normalizePhone } from './utils/phone.js';

const csv = z
  .string()
  .optional()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const number = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const boolean = (fallback: boolean) =>
  z
    .string()
    .optional()
    .default(String(fallback))
    .transform((value) => !['0', 'false', 'no', 'off'].includes(value.toLowerCase()));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TZ: z.string().default('Asia/Jakarta'),
  BOT_NAME: z.string().min(1).default('WaBot'),

  LOGIN_MODE: z.enum(['qr', 'pairing']).default('qr'),
  BOT_PHONE_NUMBER: z.string().optional(),

  OWNER_NUMBERS: csv,
  ALLOWED_NUMBERS: csv,
  ALLOWED_GROUPS: csv,

  STICKER_DEFAULT_POSITION: z.enum(['top', 'bottom', 'center']).default('bottom'),
  STICKER_MAX_CHARS: number(140, 1, 500),
  STICKER_FONT_PATH: z.string().default('assets/fonts/Anton-Regular.ttf'),
  MAX_IMAGE_MB: number(10, 1, 50),

  DOWNLOAD_MAX_MB: number(16, 1, 100),
  DOWNLOAD_SOURCE_MAX_MB: number(100, 1, 500),
  DOWNLOAD_MAX_DURATION_SEC: number(300, 30, 1_800),
  DOWNLOAD_CONCURRENCY: number(1, 1, 4),
  DOWNLOAD_TIMEOUT_MS: number(90_000, 10_000, 300_000),
  MAX_QUEUE: number(20, 1, 200),
  YTDLP_PATH: z.string().min(1).default('yt-dlp'),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  ENABLE_TIKWM_FALLBACK: boolean(true),
  IG_COOKIES_PATH: z.string().default('data/cookies/instagram.txt'),

  DATA_DIR: z.string().default('data'),
  TMP_DIR: z.string().default('data/tmp'),
  AUTH_DIR: z.string().default('data/auth'),
});

export type StickerPosition = 'top' | 'bottom' | 'center';

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: string;
  timezone: string;
  botName: string;
  loginMode: 'qr' | 'pairing';
  botPhoneNumber: string | null;
  ownerNumbers: string[];
  allowedNumbers: string[];
  allowedGroups: string[];
  sticker: {
    defaultPosition: StickerPosition;
    maxChars: number;
  };
  maxImageBytes: number;
  download: {
    maxBytes: number;
    sourceMaxBytes: number;
    maxDurationSec: number;
    concurrency: number;
    timeoutMs: number;
    maxQueue: number;
    ytdlpPath: string;
    ffmpegPath: string;
    ffprobePath: string;
    tikwmFallback: boolean;
    instagramCookiesPath: string;
  };
  paths: {
    dataDir: string;
    tmpDir: string;
    authDir: string;
    cookiesDir: string;
    fontPath: string;
  };
}

function parsePhoneList(entries: string[], label: string): string[] {
  const normalized = new Set<string>();
  const invalid: string[] = [];

  for (const entry of entries) {
    const phone = normalizePhone(entry);

    if (phone) {
      normalized.add(phone);
    } else {
      invalid.push(entry);
    }
  }

  if (invalid.length > 0) {
    throw new ConfigError(`${label} berisi nomor tidak valid: ${invalid.join(', ')}`);
  }

  return [...normalized];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Konfigurasi .env tidak valid:\n${details}`);
  }

  const raw = parsed.data;
  const ownerNumbers = parsePhoneList(raw.OWNER_NUMBERS, 'OWNER_NUMBERS');
  const allowedNumbers = parsePhoneList(raw.ALLOWED_NUMBERS, 'ALLOWED_NUMBERS');
  const botPhoneNumber = raw.BOT_PHONE_NUMBER ? normalizePhone(raw.BOT_PHONE_NUMBER) : null;

  if (raw.LOGIN_MODE === 'pairing' && !botPhoneNumber) {
    throw new ConfigError('LOGIN_MODE=pairing membutuhkan BOT_PHONE_NUMBER yang valid.');
  }

  const dataDir = path.resolve(raw.DATA_DIR);
  const tmpDir = path.resolve(raw.TMP_DIR);
  const authDir = path.resolve(raw.AUTH_DIR);
  const cookiesPath = path.resolve(raw.IG_COOKIES_PATH);
  const fontPath = path.resolve(raw.STICKER_FONT_PATH);

  return {
    nodeEnv: raw.NODE_ENV,
    logLevel: raw.LOG_LEVEL,
    timezone: raw.TZ,
    botName: raw.BOT_NAME,
    loginMode: raw.LOGIN_MODE,
    botPhoneNumber,
    ownerNumbers,
    allowedNumbers,
    allowedGroups: raw.ALLOWED_GROUPS,
    sticker: {
      defaultPosition: raw.STICKER_DEFAULT_POSITION,
      maxChars: raw.STICKER_MAX_CHARS,
    },
    maxImageBytes: raw.MAX_IMAGE_MB * 1024 * 1024,
    download: {
      maxBytes: raw.DOWNLOAD_MAX_MB * 1024 * 1024,
      sourceMaxBytes: raw.DOWNLOAD_SOURCE_MAX_MB * 1024 * 1024,
      maxDurationSec: raw.DOWNLOAD_MAX_DURATION_SEC,
      concurrency: raw.DOWNLOAD_CONCURRENCY,
      timeoutMs: raw.DOWNLOAD_TIMEOUT_MS,
      maxQueue: raw.MAX_QUEUE,
      ytdlpPath: raw.YTDLP_PATH,
      ffmpegPath: raw.FFMPEG_PATH,
      ffprobePath: raw.FFPROBE_PATH,
      tikwmFallback: raw.ENABLE_TIKWM_FALLBACK,
      instagramCookiesPath: cookiesPath,
    },
    paths: {
      dataDir,
      tmpDir,
      authDir,
      cookiesDir: path.dirname(cookiesPath),
      fontPath,
    },
  };
}
