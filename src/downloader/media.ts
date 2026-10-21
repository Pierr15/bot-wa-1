import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AppLogger } from '../core/logger.js';
import { runProcess } from './process.js';

export type MediaKind = 'video' | 'image' | 'audio' | 'document';

export interface MediaFile {
  path: string;
  name: string;
  extension: string;
  kind: MediaKind;
  size: number;
}

const EXTENSION_KINDS: Record<string, MediaKind> = {
  mp4: 'video',
  m4v: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  mp3: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  opus: 'audio',
};

const MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
};

export function extensionOf(fileName: string): string {
  return path.extname(fileName).toLowerCase().replace(/^\./u, '');
}

export function mediaKindOf(extension: string): MediaKind | null {
  return EXTENSION_KINDS[extension] ?? null;
}

export function mimeTypeOf(extension: string): string {
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

export async function listMediaFiles(dir: string): Promise<MediaFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: MediaFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) {
      continue;
    }

    const extension = extensionOf(entry.name);
    const kind = mediaKindOf(extension);

    if (!kind) {
      continue;
    }

    const filePath = path.join(dir, entry.name);

    try {
      const info = await stat(filePath);
      if (info.size === 0) {
        continue;
      }

      files.push({
        path: filePath,
        name: entry.name,
        extension,
        kind,
        size: info.size,
      });
    } catch {
      // File may disappear while yt-dlp is still finalizing.
    }
  }

  return files.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export interface VideoInfo {
  durationSec: number | null;
  codec: string | null;
}

export async function probeVideoInfo(filePath: string, ffprobePath: string): Promise<VideoInfo> {
  try {
    const result = await runProcess(
      ffprobePath,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name:format=duration',
        '-of',
        'json',
        filePath,
      ],
      { timeoutMs: 15_000 },
    );

    if (result.code !== 0) {
      return { durationSec: null, codec: null };
    }

    const parsed = JSON.parse(result.stdout) as {
      streams?: Array<{ codec_name?: string }>;
      format?: { duration?: string };
    };
    const duration = Number(parsed.format?.duration);
    const codec = parsed.streams?.[0]?.codec_name?.toLowerCase() ?? null;

    return {
      durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
      codec,
    };
  } catch {
    return { durationSec: null, codec: null };
  }
}

export interface CompressVideoOptions {
  inputPath: string;
  outputPath: string;
  ffmpegPath: string;
  maxBytes: number;
  logger: AppLogger;
}

/**
 * Compress to WhatsApp-friendly H.264 in up to three passes.
 * Returns null when ffmpeg is unavailable or all attempts fail.
 */
export async function compressVideo({
  inputPath,
  outputPath,
  ffmpegPath,
  maxBytes,
  logger,
}: CompressVideoOptions): Promise<{ path: string; size: number } | null> {
  const attempts = [
    { height: 720, crf: 28, audioBitrate: '96k' },
    { height: 480, crf: 30, audioBitrate: '64k' },
    { height: 360, crf: 32, audioBitrate: '64k' },
  ];

  let lastResult: { path: string; size: number } | null = null;

  for (const [index, attempt] of attempts.entries()) {
    const target = index === 0 ? outputPath : outputPath.replace(/\.mp4$/u, `-${index}.mp4`);

    try {
      const result = await runProcess(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          inputPath,
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
          '-vf',
          `scale=-2:${attempt.height}`,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          String(attempt.crf),
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          attempt.audioBitrate,
          '-max_muxing_queue_size',
          '1024',
          '-movflags',
          '+faststart',
          target,
        ],
        { timeoutMs: 300_000 },
      );

      if (result.code !== 0) {
        logger.warn(
          { code: result.code, stderr: result.stderr.slice(-500), attempt: attempt.height },
          'ffmpeg gagal mengompres video',
        );
        continue;
      }

      const info = await stat(target);
      lastResult = { path: target, size: info.size };

      if (info.size <= maxBytes) {
        return lastResult;
      }
    } catch (error) {
      logger.warn({ err: error, attempt: attempt.height }, 'ffmpeg tidak bisa dijalankan');
      return null;
    }
  }

  return lastResult;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
