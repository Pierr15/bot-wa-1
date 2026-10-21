import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { DownloadError } from '../core/errors.js';
import type { AppLogger } from '../core/logger.js';
import type { DetectedLink } from './detect.js';
import { listMediaFiles, type MediaFile } from './media.js';
import { ProcessError, runProcess, type ProcessResult } from './process.js';

// TikTok labels its watermarked formats in format_note. Prefer H.264 direct
// streams without the watermark; if none exist, let the download fail so the
// TikWM fallback can try instead of silently sending a watermarked video.
const TIKTOK_FORMAT =
  'best[format_id!^=download_addr][format_note!*=watermark][vcodec^=h264]/best[format_id!^=download_addr][format_note!*=watermark]/bestvideo*[format_id!^=download_addr][format_note!*=watermark]+bestaudio';

function isTikTokPhotoPost(rawUrl: string): boolean {
  try {
    return /^\/@[^/]+\/photo\//u.test(new URL(rawUrl).pathname);
  } catch {
    return false;
  }
}

export interface BuildYtDlpArgsOptions {
  outputTemplate: string;
  cookiesPath?: string | null;
  maxSourceBytes: number;
}

export function buildYtDlpArgs(
  link: DetectedLink,
  { outputTemplate, cookiesPath, maxSourceBytes }: BuildYtDlpArgsOptions,
): string[] {
  const maxMegabytes = Math.max(1, Math.floor(maxSourceBytes / 1024 / 1024));
  const args = [
    '--no-warnings',
    '--no-progress',
    '--newline',
    '--no-cache-dir',
    '--no-write-info-json',
    '--no-write-thumbnail',
    '--no-write-description',
    '--restrict-filenames',
    '--yes-playlist',
    '--playlist-items',
    '1-10',
    '--socket-timeout',
    '20',
    '--retries',
    '2',
    '--fragment-retries',
    '2',
    '--concurrent-fragments',
    '4',
    '--merge-output-format',
    'mp4',
    '--remux-video',
    'mp4',
    '--max-filesize',
    `${maxMegabytes}M`,
    '--print',
    'after_move:filepath',
    '--output',
    outputTemplate,
  ];

  if (link.platform === 'tiktok' && !isTikTokPhotoPost(link.url)) {
    args.push('--format', TIKTOK_FORMAT);
  }

  if (link.platform === 'instagram' && cookiesPath) {
    args.push('--cookies', cookiesPath);
  }

  args.push('--', link.url);
  return args;
}

export function describeYtDlpFailure(stderr: string): { technical: string; userMessage: string } {
  const lines = stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine =
    [...lines].reverse().find((line) => /error|unable|failed|private|login/iu.test(line)) ??
    lines.at(-1) ??
    'yt-dlp gagal tanpa pesan error';
  const technical = errorLine.replace(/^ERROR:\s*/iu, '').slice(0, 500);
  const haystack = `${stderr}\n${technical}`;

  if (
    /login|sign in|cookies|private|not available|age-restricted|rate.?limit|429/iu.test(haystack)
  ) {
    return {
      technical,
      userMessage:
        'Konten ini private atau butuh login. Kalau ini Instagram, cookies mungkin perlu diperbarui.',
    };
  }

  if (/unsupported url|no video formats|no formats found/iu.test(haystack)) {
    return { technical, userMessage: 'Link ini tidak didukung oleh downloader.' };
  }

  if (/max-filesize|larger than|file is too large/iu.test(haystack)) {
    return { technical, userMessage: 'File terlalu besar untuk diunduh.' };
  }

  if (/404|not found|unavailable|does not exist/iu.test(haystack)) {
    return { technical, userMessage: 'Konten tidak ditemukan atau sudah dihapus.' };
  }

  if (/timed? ?out|timeout/iu.test(haystack)) {
    return { technical, userMessage: 'Download terlalu lama. Coba lagi nanti.' };
  }

  return { technical, userMessage: 'Gagal mengunduh. Coba lagi nanti.' };
}

export class YtDlpDownloader {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
  ) {}

  async check(): Promise<{ available: boolean; version?: string }> {
    try {
      const result = await runProcess(this.config.download.ytdlpPath, ['--version'], {
        timeoutMs: 15_000,
      });

      if (result.code === 0) {
        return { available: true, version: result.stdout.trim() };
      }
    } catch {
      // Missing binary or timeout; reported below.
    }

    return { available: false };
  }

  async download(link: DetectedLink, tempDir: string): Promise<MediaFile[]> {
    const outputTemplate = path.join(tempDir, '%(autonumber)02d-%(id)s.%(ext)s');
    const cookiesPath = this.resolveCookiesPath(link.platform);
    const args = buildYtDlpArgs(link, {
      outputTemplate,
      cookiesPath,
      maxSourceBytes: this.config.download.sourceMaxBytes,
    });

    let result: ProcessResult;

    try {
      result = await runProcess(this.config.download.ytdlpPath, args, {
        timeoutMs: this.config.download.timeoutMs,
        cwd: tempDir,
      });
    } catch (error) {
      if (error instanceof ProcessError) {
        throw new DownloadError(error.message, 'Download terlalu lama atau gagal dijalankan.');
      }

      throw error;
    }

    const files = await listMediaFiles(tempDir);

    if (files.length === 0) {
      const failure = describeYtDlpFailure(result.stderr);
      throw new DownloadError(
        `yt-dlp exit ${result.code}: ${failure.technical}`,
        failure.userMessage,
      );
    }

    if (result.code !== 0) {
      this.logger.warn(
        { code: result.code, stderr: result.stderr.slice(-800), files: files.length },
        'yt-dlp keluar dengan error tetapi ada file yang berhasil diunduh',
      );
    }

    this.logger.info(
      { platform: link.platform, files: files.length, source: 'yt-dlp' },
      'Media berhasil diunduh',
    );
    return files;
  }

  private resolveCookiesPath(platform: DetectedLink['platform']): string | null {
    if (platform !== 'instagram') {
      return null;
    }

    const cookiesPath = this.config.download.instagramCookiesPath;

    if (existsSync(cookiesPath)) {
      return cookiesPath;
    }

    this.logger.warn(
      { path: cookiesPath },
      'Cookies Instagram tidak ditemukan; konten yang butuh login akan gagal',
    );
    return null;
  }
}
