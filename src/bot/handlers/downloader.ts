import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AnyMessageContent, WAMessage, WASocket } from 'baileys';
import PQueue from 'p-queue';
import type { AppConfig } from '../../config.js';
import { DownloadError, UserFacingError, errorMessage } from '../../core/errors.js';
import type { AppLogger } from '../../core/logger.js';
import { RateLimiter } from '../../core/rate-limit.js';
import { stats } from '../../core/stats.js';
import { getFreeDiskBytes } from '../../core/storage.js';
import type { DetectedLink } from '../../downloader/detect.js';
import { Downloader, type DownloadBundle } from '../../downloader/downloader.js';
import {
  compressVideo,
  extractAudio,
  formatBytes,
  mimeTypeOf,
  probeHasAudio,
  probeVideoInfo,
  type MediaFile,
} from '../../downloader/media.js';
import type { BotConnection } from '../connection.js';

const RATE_LIMITS = {
  tiktok: { limit: 3, windowMs: 5 * 60_000 },
  instagram: { limit: 2, windowMs: 10 * 60_000 },
} as const;

const SEND_DELAY_MS = 1_000;
const CHOICE_TTL_MS = 10 * 60_000;

type ChoiceKind = 'video' | 'audio' | 'image';

interface DownloadPlan {
  platform: DetectedLink['platform'];
  files: MediaFile[];
  expiresAt: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class DownloaderHandler {
  private readonly downloader: Downloader;
  private readonly queue: PQueue;
  private readonly rate = new RateLimiter();
  private readonly plans = new Map<string, DownloadPlan>();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly connection: BotConnection,
  ) {
    this.downloader = new Downloader(config, logger);
    this.queue = new PQueue({ concurrency: config.download.concurrency });
  }

  async initialize(): Promise<void> {
    await this.downloader.initialize();
  }

  stop(): void {
    this.queue.clear();
    this.plans.clear();
    this.downloader.stop();
  }

  async handle(
    message: WAMessage,
    chatJid: string,
    links: DetectedLink[],
    senderId: string,
    isOwner: boolean,
  ): Promise<void> {
    const link = links[0];

    if (!link) {
      return;
    }

    if (links.length > 1) {
      await this.reply(
        chatJid,
        'Aku proses link pertama dulu ya. Kirim satu link per pesan supaya antreannya rapi.',
        message,
      );
    }

    const freeBytes = await getFreeDiskBytes(this.config.paths.tmpDir);

    if (freeBytes !== null && freeBytes < this.config.download.minFreeDiskBytes) {
      await this.reply(
        chatJid,
        `Penyimpanan HP hampir penuh (sisa ${formatBytes(freeBytes)}). Hapus beberapa file lalu coba lagi.`,
        message,
      );
      return;
    }

    if (this.queue.size + this.queue.pending >= this.config.download.maxQueue) {
      await this.reply(chatJid, 'Antrean download sedang penuh. Coba lagi sebentar lagi.', message);
      return;
    }

    if (!isOwner) {
      const rule = RATE_LIMITS[link.platform];
      const result = this.rate.take(`${link.platform}:${senderId}`, rule.limit, rule.windowMs);

      if (!result.allowed) {
        const minutes = Math.max(1, Math.ceil(result.retryAfterMs / 60_000));
        await this.reply(
          chatJid,
          `Batas download ${link.platform} tercapai. Coba lagi dalam ${minutes} menit.`,
          message,
        );
        return;
      }
    }

    await this.react(message, chatJid, '⏳');
    let tempDir: string | null = null;
    let keepTempDir = false;

    try {
      const workDir = await mkdtemp(path.join(this.config.paths.tmpDir, 'dl-'));
      tempDir = workDir;

      const bundle = await this.queue.add<DownloadBundle>(() =>
        this.downloader.download(link, workDir),
      );
      const sent = await this.sendBundle(message, chatJid, bundle.files, link.platform, workDir);

      if (sent === 0) {
        throw new DownloadError(
          'Tidak ada file yang berhasil dikirim',
          'Media berhasil diunduh tetapi gagal dikirim. Coba lagi nanti.',
        );
      }

      // Keep the folder alive for follow-up .v/.a/.f choices; the tmp janitor
      // removes it together with everything older than 6 hours.
      this.plans.set(chatJid, {
        platform: link.platform,
        files: bundle.files,
        expiresAt: Date.now() + CHOICE_TTL_MS,
      });
      keepTempDir = sent > 0;

      stats.record('download');
      await this.react(message, chatJid, '✅');
      this.logger.info(
        {
          platform: link.platform,
          source: bundle.source,
          files: bundle.files.length,
          sent,
          chatSuffix: chatJid.slice(chatJid.indexOf('@')),
        },
        'Download selesai',
      );
    } catch (error) {
      stats.record('download_gagal');
      await this.react(message, chatJid, '❌');
      const userMessage =
        error instanceof DownloadError
          ? error.userMessage
          : error instanceof UserFacingError
            ? error.message
            : 'Gagal mengunduh. Coba lagi nanti.';

      this.logger.error(
        { err: error, error: errorMessage(error), platform: link.platform, host: link.host },
        'Download gagal',
      );
      await this.reply(chatJid, userMessage, message);
    } finally {
      if (tempDir && !keepTempDir) {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(
          (error: unknown) => {
            this.logger.warn({ err: error }, 'Gagal menghapus folder download');
          },
        );
      }
    }
  }

  /** Follow-up chooser: .v (video), .a (audio), .f [N] (foto). */
  async handleChoice(
    message: WAMessage,
    chatJid: string,
    kind: ChoiceKind,
    args = '',
  ): Promise<void> {
    const plan = this.plans.get(chatJid);

    if (!plan || plan.expiresAt <= Date.now()) {
      this.plans.delete(chatJid);
      await this.reply(
        chatJid,
        'Tidak ada media tersimpan. Kirim link TikTok/Instagram dulu, lalu reply hasilnya dengan `.v`, `.a`, atau `.f`.',
        message,
      );
      return;
    }

    const label = plan.platform === 'tiktok' ? 'TikTok' : 'Instagram';

    try {
      if (kind === 'video') {
        const videos = plan.files.filter((file) => file.kind === 'video');

        if (videos.length === 0) {
          await this.reply(chatJid, `Download ${label} ini tidak punya video. Coba \`.f\`.`, message);
          return;
        }

        await this.queue.add(() =>
          this.sendBundle(message, chatJid, videos, plan.platform, path.dirname(videos[0]?.path ?? '')),
        );
      } else if (kind === 'audio') {
        const video = plan.files.find((file) => file.kind === 'video');

        if (!video) {
          await this.reply(
            chatJid,
            `Download ${label} ini tidak punya video untuk diekstrak audionya.`,
            message,
          );
          return;
        }

        const hasAudio = await this.queue.add(() =>
          probeHasAudio(video.path, this.config.download.ffprobePath),
        );

        if (!hasAudio) {
          await this.reply(chatJid, 'Video ini tidak punya trek audio.', message);
          return;
        }

        const target = path.join(path.dirname(video.path), `audio-${Date.now()}.m4a`);
        const audio = await this.queue.add(() =>
          extractAudio({
            inputPath: video.path,
            outputPath: target,
            ffmpegPath: this.config.download.ffmpegPath,
          }),
        );

        if (!audio) {
          throw new UserFacingError('Gagal mengekstrak audio. Coba lagi nanti.');
        }

        await this.queue.add(async () => {
          const socket = this.connection.getSocket();
          const success = await this.sendFile(
            socket,
            chatJid,
            {
              path: audio.path,
              name: path.basename(audio.path),
              extension: 'm4a',
              kind: 'audio',
              size: audio.size,
            },
            '🎵 audio',
            message,
            false,
          );

          if (!success) {
            throw new UserFacingError('Gagal mengirim audio. Coba lagi nanti.');
          }
        });
      } else {
        const images = plan.files.filter((file) => file.kind === 'image');

        if (images.length === 0) {
          await this.reply(
            chatJid,
            `Download ${label} ini tidak punya foto. Coba \`.v\` atau \`.a\`.`,
            message,
          );
          return;
        }

        const requested = args.trim();
        let selected = images;

        if (requested) {
          const index = Number.parseInt(requested, 10);

          if (!Number.isInteger(index) || index < 1 || index > images.length) {
            await this.reply(
              chatJid,
              `Nomor foto harus 1-${images.length}. Contoh: \`.f 1\`.`,
              message,
            );
            return;
          }

          selected = [images[index - 1]!];
        }

        await this.queue.add(() =>
          this.sendBundle(message, chatJid, selected, plan.platform, path.dirname(images[0]?.path ?? '')),
        );
      }

      plan.expiresAt = Date.now() + CHOICE_TTL_MS;
    } catch (error) {
      const userMessage =
        error instanceof UserFacingError
          ? error.message
          : 'Gagal memproses pilihan. Coba lagi sebentar lagi.';

      this.logger.error(
        { err: error, error: errorMessage(error), kind, chat: chatJid.slice(chatJid.indexOf('@')) },
        'Gagal memproses pilihan media',
      );
      await this.reply(chatJid, userMessage, message);
    }
  }

  private async sendBundle(
    message: WAMessage,
    chatJid: string,
    files: MediaFile[],
    platform: DetectedLink['platform'],
    tempDir: string,
  ): Promise<number> {
    const label = platform === 'tiktok' ? 'TikTok' : 'Instagram';
    const socket = this.connection.getSocket();
    let sent = 0;
    let quoteNext = true;

    for (const [index, original] of files.entries()) {
      let file = original;
      let asDocument = false;

      if (file.kind === 'video') {
        let codec: string | null = null;

        if (this.downloader.canProbe) {
          const info = await probeVideoInfo(file.path, this.config.download.ffprobePath);
          codec = info.codec;

          if (info.durationSec && info.durationSec > this.config.download.maxDurationSec) {
            throw new DownloadError(
              `Durasi video ${info.durationSec.toFixed(1)} detik melebihi batas ${this.config.download.maxDurationSec}`,
              `Videonya terlalu panjang. Maksimal ${Math.round(
                this.config.download.maxDurationSec / 60,
              )} menit.`,
            );
          }
        }

        const isH264 = codec === 'h264' || codec === 'avc1';
        const needsMp4 = file.extension !== 'mp4';
        const needsCompression =
          file.size > this.config.download.maxBytes || needsMp4 || (codec !== null && !isH264);

        if (needsCompression && this.downloader.canCompress) {
          const compressed = await compressVideo({
            inputPath: file.path,
            outputPath: path.join(tempDir, `compressed-${index + 1}.mp4`),
            ffmpegPath: this.config.download.ffmpegPath,
            maxBytes: this.config.download.maxBytes,
            logger: this.logger,
          });

          if (compressed) {
            file = {
              ...file,
              path: compressed.path,
              name: path.basename(compressed.path),
              extension: 'mp4',
              kind: 'video',
              size: compressed.size,
            };
          } else if (needsMp4 || (codec !== null && !isH264)) {
            asDocument = true;
          }
        } else if (needsMp4 || (codec !== null && !isH264)) {
          asDocument = true;
        }

        if (file.size > this.config.download.maxBytes) {
          asDocument = true;
        }
      } else if (file.size > this.config.download.maxBytes) {
        asDocument = true;
      }

      const caption =
        files.length > 1 ? `📥 ${label} • ${index + 1}/${files.length}` : `📥 ${label}`;
      const quoted = quoteNext ? message : undefined;
      const success = await this.sendFile(socket, chatJid, file, caption, quoted, asDocument);

      if (success) {
        sent += 1;
        quoteNext = false;
      } else {
        this.logger.warn(
          { file: file.name, size: formatBytes(file.size), kind: file.kind, asDocument },
          'Satu file gagal dikirim',
        );
      }

      await delay(SEND_DELAY_MS);
    }

    return sent;
  }

  private async sendFile(
    socket: WASocket,
    chatJid: string,
    file: MediaFile,
    caption: string,
    quoted: WAMessage | undefined,
    asDocument: boolean,
  ): Promise<boolean> {
    const options = quoted ? { quoted } : undefined;

    try {
      if (file.kind === 'video' && !asDocument) {
        const buffer = await readFile(file.path);
        await socket.sendMessage(
          chatJid,
          { video: buffer, mimetype: 'video/mp4', caption },
          options,
        );
        return true;
      }

      if (file.kind === 'image' && !asDocument) {
        const buffer = await readFile(file.path);
        await socket.sendMessage(
          chatJid,
          { image: buffer, mimetype: mimeTypeOf(file.extension), caption },
          options,
        );
        return true;
      }

      if (file.kind === 'audio' && !asDocument) {
        const buffer = await readFile(file.path);
        await socket.sendMessage(
          chatJid,
          { audio: buffer, mimetype: mimeTypeOf(file.extension), ptt: false },
          options,
        );
        return true;
      }

      const content: AnyMessageContent = {
        document: { stream: createReadStream(file.path) },
        mimetype: mimeTypeOf(file.extension),
        fileName: file.name,
        caption,
      };

      await socket.sendMessage(chatJid, content, options);
      return true;
    } catch (error) {
      this.logger.error(
        { err: error, error: errorMessage(error), file: file.name, kind: file.kind },
        'Gagal mengirim media',
      );
      return false;
    }
  }

  private async react(message: WAMessage, chatJid: string, text: string): Promise<void> {
    try {
      const socket = this.connection.getSocket();
      await socket.sendMessage(chatJid, {
        react: {
          text,
          key: message.key,
        },
      });
    } catch (error) {
      this.logger.debug({ err: error, error: errorMessage(error) }, 'Gagal mengirim reaksi');
    }
  }

  private async reply(chatJid: string, text: string, quoted?: WAMessage): Promise<void> {
    const socket = this.connection.getSocket();

    try {
      await socket.sendPresenceUpdate('composing', chatJid);
      await socket.sendMessage(chatJid, { text }, quoted ? { quoted } : undefined);
    } finally {
      await socket.sendPresenceUpdate('paused', chatJid).catch(() => undefined);
    }
  }
}
