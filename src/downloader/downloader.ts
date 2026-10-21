import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { DownloadError } from '../core/errors.js';
import type { AppLogger } from '../core/logger.js';
import type { DetectedLink } from './detect.js';
import { listMediaFiles, type MediaFile } from './media.js';
import { runProcess, terminateAllProcesses } from './process.js';
import { downloadTikTokWithTikwm } from './tikwm.js';
import { YtDlpDownloader } from './ytdlp.js';

export interface DownloadBundle {
  source: 'yt-dlp' | 'tikwm';
  files: MediaFile[];
}

async function clearDirectory(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  await Promise.all(
    entries.map((entry) =>
      rm(path.join(dir, entry.name), { recursive: true, force: true }).catch(() => undefined),
    ),
  );
}

export class Downloader {
  private readonly ytdlp: YtDlpDownloader;
  private initPromise: Promise<void> | null = null;
  private ytdlpAvailable = false;
  private ffmpegAvailable = false;
  private ffprobeAvailable = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
  ) {
    this.ytdlp = new YtDlpDownloader(config, logger);
  }

  async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }

    return this.initPromise;
  }

  stop(): void {
    terminateAllProcesses();
  }

  get canCompress(): boolean {
    return this.ffmpegAvailable;
  }

  get canProbe(): boolean {
    return this.ffprobeAvailable;
  }

  get canUseYtDlp(): boolean {
    return this.ytdlpAvailable;
  }

  async download(link: DetectedLink, tempDir: string): Promise<DownloadBundle> {
    await this.initialize();

    if (link.platform === 'instagram' && !this.ytdlpAvailable) {
      throw new DownloadError(
        'yt-dlp tidak tersedia untuk Instagram',
        'Downloader Instagram belum siap: yt-dlp tidak ditemukan di server.',
      );
    }

    if (this.ytdlpAvailable) {
      try {
        const files = await this.ytdlp.download(link, tempDir);
        return { source: 'yt-dlp', files };
      } catch (error) {
        if (link.platform !== 'tiktok' || !this.config.download.tikwmFallback) {
          throw error;
        }

        this.logger.warn(
          { err: error, platform: link.platform },
          'yt-dlp gagal; mencoba fallback TikWM',
        );
        await clearDirectory(tempDir);
        await mkdir(tempDir, { recursive: true });
      }
    }

    if (link.platform === 'tiktok' && this.config.download.tikwmFallback) {
      const files = await downloadTikTokWithTikwm(link, tempDir, this.config, this.logger);
      return { source: 'tikwm', files };
    }

    throw new DownloadError(
      'Tidak ada backend download yang tersedia',
      'Downloader belum siap. Pastikan yt-dlp sudah terpasang.',
    );
  }

  async listDownloadedFiles(tempDir: string): Promise<MediaFile[]> {
    return listMediaFiles(tempDir);
  }

  private async doInitialize(): Promise<void> {
    const [ytdlp, ffmpeg, ffprobe] = await Promise.all([
      this.ytdlp.check(),
      this.checkBinary(this.config.download.ffmpegPath, ['-version']),
      this.checkBinary(this.config.download.ffprobePath, ['-version']),
    ]);

    this.ytdlpAvailable = ytdlp.available;
    this.ffmpegAvailable = ffmpeg.available;
    this.ffprobeAvailable = ffprobe.available;

    if (ytdlp.available) {
      this.logger.info({ version: ytdlp.version }, 'yt-dlp siap');
    } else {
      this.logger.warn(
        { path: this.config.download.ytdlpPath },
        'yt-dlp tidak ditemukan; TikTok masih bisa lewat TikWM, Instagram tidak bisa',
      );
    }

    if (ffmpeg.available) {
      this.logger.info({ version: ffmpeg.version }, 'ffmpeg siap');
    } else {
      this.logger.warn(
        { path: this.config.download.ffmpegPath },
        'ffmpeg tidak ditemukan; video besar akan dikirim sebagai dokumen',
      );
    }

    if (!ffprobe.available) {
      this.logger.warn(
        { path: this.config.download.ffprobePath },
        'ffprobe tidak ditemukan; durasi dan codec video tidak bisa diperiksa',
      );
    }

    if (this.config.download.tikwmFallback) {
      this.logger.warn(
        'Fallback TikWM aktif: link TikTok bisa dikirim ke tikwm.com jika yt-dlp gagal',
      );
    }
  }

  private async checkBinary(
    command: string,
    args: string[],
  ): Promise<{ available: boolean; version?: string }> {
    try {
      const result = await runProcess(command, args, { timeoutMs: 15_000 });

      if (result.code === 0) {
        const firstLine = result.stdout.split(/\r?\n/u)[0]?.trim();
        return { available: true, version: firstLine?.slice(0, 120) };
      }
    } catch {
      // Missing binary or timeout; reported by the caller.
    }

    return { available: false };
  }
}
