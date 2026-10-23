import { downloadContentFromMessage, type WAMessage, type WAMessageContent } from 'baileys';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import PQueue from 'p-queue';
import type { AppConfig } from '../../config.js';
import { UserFacingError, errorMessage } from '../../core/errors.js';
import type { AppLogger } from '../../core/logger.js';
import { stats } from '../../core/stats.js';
import { createAnimatedSticker } from '../../sticker/animation.js';
import { createSticker, encodeStickerWebp } from '../../sticker/render.js';
import { parseStickerText, renderTextLayer, type TextZones } from '../../sticker/text.js';
import type { BotConnection } from '../connection.js';
import { getQuotedMessage } from '../messages.js';

type ImageMessage = NonNullable<WAMessageContent['imageMessage']>;
type VideoMessage = NonNullable<WAMessageContent['videoMessage']>;

type MediaMessage = ImageMessage | VideoMessage;
type DownloadableMedia = 'image' | 'video';

export class StickerHandler {
  private readonly queue = new PQueue({ concurrency: 2 });

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly connection: BotConnection,
  ) {}

  async handleStickerCommand(
    message: WAMessage,
    chatJid: string,
    content: WAMessageContent,
    args: string,
  ): Promise<void> {
    const image = content.imageMessage ?? getQuotedMessage(content)?.imageMessage ?? null;
    const video = content.videoMessage ?? getQuotedMessage(content)?.videoMessage ?? null;

    if (video) {
      await this.generateAnimated(message, chatJid, video, args.trim());
      return;
    }

    if (!image) {
      await this.reply(
        chatJid,
        'Kirim foto dengan caption `.s` untuk membuat stiker, atau reply foto/video Anda dengan `.s`.',
        message,
      );
      return;
    }

    const trimmed = args.trim();

    if (!trimmed) {
      await this.generatePhoto(message, chatJid, image, null);
      return;
    }

    const zones = this.parseOrReply(trimmed, chatJid, message);

    if (!zones) {
      return;
    }

    await this.generatePhoto(message, chatJid, image, zones);
  }

  async handleTextCommand(message: WAMessage, chatJid: string, args: string): Promise<void> {
    const trimmed = args.trim();

    if (!trimmed) {
      await this.reply(
        chatJid,
        'Stiker teks putih di dasar putih (`.t`). Contoh:\n' +
          '• `.t KEREN` — teks di bawah\n' +
          '• `.t | KEREN` — teks di atas\n' +
          '• `.t TEKS BAWAH | TEKS ATAS` — dua zona',
        message,
      );
      return;
    }

    const zones = this.parseOrReply(trimmed, chatJid, message);

    if (!zones) {
      return;
    }

    const png = await renderTextLayer(zones, this.config.paths.fontPath, '#ffffff');
    const encoded = await encodeStickerWebp({ input: png });

    if (!encoded) {
      await this.reply(
        chatJid,
        'Terlalu banyak teks untuk stiker dua zona. Perpendek atau pisah jadi dua stiker.',
        message,
      );
      return;
    }

    await this.sendSticker(message, chatJid, encoded.buffer, { hasText: true });
  }

  async sendHint(chatJid: string, message: WAMessage): Promise<void> {
    await this.reply(
      chatJid,
      'Media ini belum diproses. Reply dengan `.s` atau `.sticker` untuk menjadikannya stiker.\n\n' +
        '• `.s` — stiker polos\n' +
        '• `.s KEREN` — stiker dengan teks di bawah\n' +
        '• `.s KEREN | HALO` — teks dua zona (kiri bawah, kanan atas)\n' +
        '• Video/GIF dikirim dengan `.s` — stiker animasi ' +
          `(${this.config.sticker.animMaxSeconds} detik pertama)`,
      message,
    );
  }

  stop(): void {
    this.queue.clear();
  }

  private parseOrReply(text: string, chatJid: string, message: WAMessage): TextZones | null {
    try {
      return parseStickerText(
        text,
        this.config.sticker.defaultPosition,
        this.config.sticker.maxChars,
      );
    } catch (error) {
      const userMessage =
        error instanceof UserFacingError ? error.message : 'Teks stiker tidak valid.';

      void this.reply(chatJid, userMessage, message).catch((replyError: unknown) => {
        this.logger.warn(
          { err: replyError, error: errorMessage(replyError) },
          'Gagal mengirim pesan kesalahan teks stiker',
        );
      });
      return null;
    }
  }

  private async generatePhoto(
    message: WAMessage,
    chatJid: string,
    image: ImageMessage,
    text: TextZones | null,
  ): Promise<boolean> {
    await this.react(message, chatJid, '⏳');

    try {
      const input = await this.downloadMedia(image, 'image');
      const result = await this.queue.add(() =>
        createSticker({
          input,
          mimeType: image.mimetype,
          text,
          maxInputBytes: this.config.maxImageBytes,
          fontPath: this.config.paths.fontPath,
          logger: this.logger,
        }),
      );

      if (!result) {
        throw new Error('Sticker queue tidak mengembalikan hasil');
      }

      stats.record('stiker');
      await this.sendSticker(message, chatJid, result.buffer, { bytes: result.bytes });
      return true;
    } catch (error) {
      stats.record('stiker_gagal');
      await this.reportFailure(message, chatJid, error, 'Gagal membuat stiker');
      return false;
    }
  }

  private async generateAnimated(
    message: WAMessage,
    chatJid: string,
    video: VideoMessage,
    args: string,
  ): Promise<boolean> {
    if (args) {
      await this.reply(
        chatJid,
        'Stiker animasi belum mendukung teks, jadi stiker dibuat tanpa teks.',
        message,
      );
    }

    await this.react(message, chatJid, '⏳');

    const workDir = await mkdtemp(path.join(this.config.paths.tmpDir, 'anim-'));

    try {
      const input = await this.downloadMedia(video, 'video');
      const result = await this.queue.add(() =>
        createAnimatedSticker({
          input,
          maxDurationSec: this.config.sticker.animMaxSeconds,
          maxBytes: this.config.sticker.animMaxBytes,
          ffmpegPath: this.config.download.ffmpegPath,
          ffprobePath: this.config.download.ffprobePath,
          workDir,
          logger: this.logger,
        }),
      );

      stats.record('stiker');
      stats.record('stiker_animasi');
      await this.sendSticker(message, chatJid, result.buffer, {
        bytes: result.bytes,
        animated: true,
      });
      return true;
    } catch (error) {
      stats.record('stiker_gagal');
      await this.reportFailure(message, chatJid, error, 'Gagal membuat stiker animasi');
      return false;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Gagal menghapus folder stiker animasi');
      });
    }
  }

  /** Send and react; callers already made their own stats decisions. */
  private async sendSticker(
    message: WAMessage,
    chatJid: string,
    buffer: Buffer,
    meta: { bytes?: number; animated?: boolean; hasText?: boolean; frames?: number } = {},
  ): Promise<void> {
    const socket = this.connection.getSocket();

    try {
      await socket.sendMessage(
        chatJid,
        { sticker: buffer, isAnimated: Boolean(meta.animated) },
        { quoted: message },
      );
      await this.react(message, chatJid, '✅');

      this.logger.info(
        {
          chatSuffix: chatJid.slice(chatJid.indexOf('@')),
          animated: Boolean(meta.animated),
          bytes: meta.bytes,
          frames: meta.frames,
          hasText: Boolean(meta.hasText),
        },
        'Stiker terkirim',
      );
    } catch (error) {
      stats.record('stiker_gagal');
      await this.react(message, chatJid, '❌');
      this.logger.error(
        { err: error, error: errorMessage(error), chat: chatJid.slice(chatJid.indexOf('@')) },
        'Gagal mengirim stiker',
      );
      await this.reply(chatJid, 'Stiker jadi tetapi gagal dikirim. Coba lagi sebentar lagi.', message);
    }
  }

  private async reportFailure(
    message: WAMessage,
    chatJid: string,
    error: unknown,
    context: string,
  ): Promise<void> {
    await this.react(message, chatJid, '❌');
    const userMessage =
      error instanceof UserFacingError
        ? error.message
        : 'Gagal membuat stiker. Coba kirim ulang medianya.';

    this.logger.error(
      { err: error, messageId: message.key?.id, chat: chatJid.slice(chatJid.indexOf('@')) },
      context,
    );
    await this.reply(chatJid, userMessage, message);
  }

  private async downloadMedia(
    media: MediaMessage,
    mediaType: DownloadableMedia,
  ): Promise<Buffer> {
    const stream = await downloadContentFromMessage(media, mediaType);
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;

      if (total > this.maxMediaBytes) {
        throw new UserFacingError(
          `Ukuran medianya terlalu besar. Maksimal ${Math.floor(
            this.maxMediaBytes / 1024 / 1024,
          )} MB.`,
        );
      }

      chunks.push(buffer);
    }

    if (chunks.length === 0) {
      throw new UserFacingError('Gagal mengunduh medianya.');
    }

    return Buffer.concat(chunks);
  }

  private get maxMediaBytes(): number {
    return this.config.maxImageBytes;
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
