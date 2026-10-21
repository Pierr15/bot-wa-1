import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import type { AppConfig } from '../config.js';
import { DownloadError } from '../core/errors.js';
import type { AppLogger } from '../core/logger.js';
import type { DetectedLink } from './detect.js';
import { listMediaFiles, type MediaFile } from './media.js';

interface TikwmData {
  images?: string[];
  play?: string;
  hdplay?: string;
  music?: string;
  title?: string;
}

interface TikwmResponse {
  code?: number;
  msg?: string;
  data?: TikwmData;
}

const API_URL = 'https://www.tikwm.com/api/';
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36';
const KNOWN_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'mov',
  'webm',
  'mkv',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'mp3',
  'm4a',
  'aac',
  'ogg',
  'opus',
]);

function absoluteUrl(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw, 'https://www.tikwm.com');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function extensionFromUrl(raw: string, fallback: string): string {
  try {
    const extension = path.extname(new URL(raw).pathname).toLowerCase().replace(/^\./u, '');
    if (KNOWN_EXTENSIONS.has(extension)) {
      return extension;
    }
  } catch {
    // Use fallback.
  }

  return fallback;
}

async function downloadToFile(rawUrl: string, target: string, maxBytes: number): Promise<void> {
  let response: Response;

  try {
    response = await fetch(rawUrl, {
      headers: {
        'user-agent': USER_AGENT,
        referer: 'https://www.tikwm.com/',
      },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new DownloadError(
      `Gagal menghubungi server media: ${error instanceof Error ? error.message : String(error)}`,
      'Gagal mengunduh media. Coba lagi nanti.',
    );
  }

  if (!response.ok || !response.body) {
    throw new DownloadError(
      `Server media membalas HTTP ${response.status}`,
      'Gagal mengunduh media. Coba lagi nanti.',
    );
  }

  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > maxBytes) {
    throw new DownloadError(
      `Content-Length ${contentLength} melebihi batas ${maxBytes}`,
      'File terlalu besar untuk diunduh.',
    );
  }

  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      async function* limitSize(source: AsyncIterable<Buffer | Uint8Array>) {
        let total = 0;

        for await (const chunk of source) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.length;

          if (total > maxBytes) {
            throw new DownloadError(
              `Media melebihi batas ${maxBytes} byte`,
              'File terlalu besar untuk diunduh.',
            );
          }

          yield buffer;
        }
      },
      createWriteStream(target),
    );
  } catch (error) {
    await rm(target, { force: true }).catch(() => undefined);

    if (error instanceof DownloadError) {
      throw error;
    }

    throw new DownloadError(
      `Gagal menulis media: ${error instanceof Error ? error.message : String(error)}`,
      'Gagal mengunduh media. Coba lagi nanti.',
    );
  }
}

/**
 * Third-party fallback for TikTok. It is only used when yt-dlp fails and can
 * be disabled with ENABLE_TIKWM_FALLBACK=false.
 */
export async function downloadTikTokWithTikwm(
  link: DetectedLink,
  tempDir: string,
  config: AppConfig,
  logger: AppLogger,
): Promise<MediaFile[]> {
  let payload: TikwmResponse;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT,
      },
      body: new URLSearchParams({ url: link.url, hd: '1' }).toString(),
      signal: AbortSignal.timeout(20_000),
    });

    payload = (await response.json()) as TikwmResponse;

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new DownloadError(
      `TikWM request gagal: ${error instanceof Error ? error.message : String(error)}`,
      'Layanan cadangan TikTok sedang tidak bisa dihubungi. Coba lagi nanti.',
    );
  }

  if (payload.code !== 0 || !payload.data) {
    throw new DownloadError(
      `TikWM membalas code ${payload.code ?? '-'}: ${payload.msg ?? 'tanpa pesan'}`,
      'TikTok gagal diunduh. Pastikan link publik dan coba lagi.',
    );
  }

  const data = payload.data;
  const images = (data.images ?? [])
    .map((url) => absoluteUrl(url))
    .filter((url): url is string => Boolean(url))
    .slice(0, 10);

  try {
    if (images.length > 0) {
      for (const [index, imageUrl] of images.entries()) {
        const extension = extensionFromUrl(imageUrl, 'jpg');
        const target = path.join(tempDir, `${String(index + 1).padStart(2, '0')}.${extension}`);
        await downloadToFile(imageUrl, target, config.download.sourceMaxBytes);
      }

      const musicUrl = absoluteUrl(data.music);
      if (musicUrl) {
        try {
          const extension = extensionFromUrl(musicUrl, 'mp3');
          await downloadToFile(
            musicUrl,
            path.join(tempDir, `audio.${extension}`),
            config.download.sourceMaxBytes,
          );
        } catch (error) {
          // A slideshow is still useful without its background audio.
          logger.warn({ err: error }, 'Gagal mengunduh audio slideshow TikTok');
        }
      }
    } else {
      const videoUrl = absoluteUrl(data.hdplay) ?? absoluteUrl(data.play);

      if (!videoUrl) {
        throw new DownloadError(
          'TikWM tidak mengembalikan URL video atau gambar',
          'TikTok ini tidak berisi media yang bisa diunduh.',
        );
      }

      const extension = extensionFromUrl(videoUrl, 'mp4');
      const target = path.join(tempDir, `video.${extension}`);
      await downloadToFile(videoUrl, target, config.download.sourceMaxBytes);
    }
  } catch (error) {
    if (error instanceof DownloadError) {
      throw error;
    }

    throw new DownloadError(
      `TikWM download gagal: ${error instanceof Error ? error.message : String(error)}`,
      'Gagal mengunduh media TikTok. Coba lagi nanti.',
    );
  }

  const files = await listMediaFiles(tempDir);

  if (files.length === 0) {
    throw new DownloadError(
      'TikWM tidak menghasilkan file media yang dikenali',
      'TikTok ini tidak berisi media yang bisa diunduh.',
    );
  }

  logger.info(
    { platform: 'tiktok', files: files.length, source: 'tikwm', title: data.title?.slice(0, 80) },
    'Media TikTok diunduh lewat TikWM',
  );
  return files;
}
