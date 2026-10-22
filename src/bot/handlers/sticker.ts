import { downloadContentFromMessage, type WAMessage, type WAMessageContent } from 'baileys';
import PQueue from 'p-queue';
import type { AppConfig } from '../../config.js';
import { UserFacingError, errorMessage } from '../../core/errors.js';
import type { AppLogger } from '../../core/logger.js';
import { createSticker } from '../../sticker/render.js';
import { parseStickerText, type TextZones } from '../../sticker/text.js';
import type { BotConnection } from '../connection.js';
import { getQuotedMessage } from '../messages.js';

type ImageMessage = NonNullable<WAMessageContent['imageMessage']>;

interface PendingSticker {
  image: ImageMessage;
  message: WAMessage;
  expiresAt: number;
}

const PENDING_TTL_MS = 5 * 60_000;

export class StickerHandler {
  private readonly pending = new Map<string, PendingSticker>();
  private readonly queue = new PQueue({ concurrency: 2 });
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly connection: BotConnection,
  ) {
    this.sweepTimer = setInterval(() => this.sweepPending(), 60_000);
    this.sweepTimer.unref();
  }

  async handleIncoming(
    message: WAMessage,
    chatJid: string,
    content: WAMessageContent,
    text: string,
  ): Promise<void> {
    const directImage = content.imageMessage ?? null;
    const quotedImage = getQuotedMessage(content)?.imageMessage ?? null;
    const image = directImage ?? quotedImage;

    if (!image) {
      return;
    }

    if (directImage) {
      this.pending.delete(chatJid);
      const caption = text.trim();

      if (!caption) {
        this.setPending(chatJid, image, message);
        await this.reply(
          chatJid,
          'Foto diterima. Ketik teks stikernya sekarang.\n\n' +
            '• Default: teks di bawah\n' +
            '• Awali `atas:` atau `tengah:` untuk posisi lain\n' +
            '• Ketik `/skip` untuk tanpa teks\n\n' +
            'Berlaku 5 menit.',
          message,
        );
        return;
      }

      if (caption.toLowerCase() === '/skip') {
        await this.generate(message, chatJid, image, null);
        return;
      }

      const zones = this.parseOrReply(caption, chatJid, message);

      if (!zones) {
        this.setPending(chatJid, image, message);
        return;
      }

      await this.generate(message, chatJid, image, zones);
      return;
    }

    // A text reply to an older image: use the text as the sticker text.
    if (quotedImage) {
      const replyText = text.trim();

      if (!replyText) {
        return;
      }

      if (replyText.toLowerCase() === '/skip') {
        await this.generate(message, chatJid, quotedImage, null);
        return;
      }

      const zones = this.parseOrReply(replyText, chatJid, message);

      if (zones) {
        await this.generate(message, chatJid, quotedImage, zones);
      }
    }
  }

  async handlePendingText(message: WAMessage, chatJid: string, text: string): Promise<boolean> {
    const pending = this.pending.get(chatJid);

    if (!pending) {
      return false;
    }

    if (pending.expiresAt <= Date.now()) {
      this.pending.delete(chatJid);
      return false;
    }

    const trimmed = text.trim();

    if (!trimmed) {
      return true;
    }

    if (trimmed.toLowerCase() === '/batal') {
      this.pending.delete(chatJid);
      await this.reply(chatJid, 'Dibatalkan. Kirim foto lagi kalau mau membuat stiker.', message);
      return true;
    }

    if (trimmed.toLowerCase() === '/skip') {
      const sent = await this.generate(message, chatJid, pending.image, null);
      if (sent) {
        this.pending.delete(chatJid);
      }
      return true;
    }

    const zones = this.parseOrReply(trimmed, chatJid, message);

    if (!zones) {
      return true;
    }

    const sent = await this.generate(message, chatJid, pending.image, zones);

    if (sent) {
      this.pending.delete(chatJid);
    }

    return true;
  }

  async handleStickerCommand(
    message: WAMessage,
    chatJid: string,
    content: WAMessageContent,
    args: string,
  ): Promise<void> {
    const quotedImage = getQuotedMessage(content)?.imageMessage ?? null;
    const pending = this.pending.get(chatJid);
    const image = quotedImage ?? pending?.image ?? null;

    if (!image) {
      await this.reply(
        chatJid,
        'Reply sebuah foto dengan `/stiker` untuk membuat stiker, atau kirim foto lalu ketik teksnya.',
        message,
      );
      return;
    }

    if (!args.trim()) {
      if (pending && !quotedImage) {
        this.setPending(chatJid, pending.image, pending.message);
        await this.reply(chatJid, 'Ketik teks stikernya, atau `/skip` untuk tanpa teks.', message);
        return;
      }

      const sent = await this.generate(message, chatJid, image, null);
      if (sent) {
        this.pending.delete(chatJid);
      }
      return;
    }

    const zones = this.parseOrReply(args, chatJid, message);

    if (!zones) {
      return;
    }

    const sent = await this.generate(message, chatJid, image, zones);

    if (sent) {
      this.pending.delete(chatJid);
    }
  }

  async skip(chatJid: string, message: WAMessage): Promise<void> {
    const pending = this.pending.get(chatJid);

    if (!pending || pending.expiresAt <= Date.now()) {
      this.pending.delete(chatJid);
      await this.reply(
        chatJid,
        'Tidak ada foto yang menunggu teks. Kirim foto dulu, lalu ketik teksnya.',
        message,
      );
      return;
    }

    const sent = await this.generate(message, chatJid, pending.image, null);

    if (sent) {
      this.pending.delete(chatJid);
    }
  }

  async cancel(chatJid: string, message: WAMessage): Promise<void> {
    if (!this.pending.has(chatJid)) {
      await this.reply(chatJid, 'Tidak ada stiker yang sedang menunggu teks.', message);
      return;
    }

    this.pending.delete(chatJid);
    await this.reply(chatJid, 'Dibatalkan. Kirim foto lagi kalau mau membuat stiker.', message);
  }

  clearPending(chatJid: string): void {
    this.pending.delete(chatJid);
  }

  stop(): void {
    clearInterval(this.sweepTimer);
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

  private async generate(
    message: WAMessage,
    chatJid: string,
    image: ImageMessage,
    text: TextZones | null,
  ): Promise<boolean> {
    await this.react(message, chatJid, '⏳');

    try {
      const input = await this.downloadImage(image);
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

      const socket = this.connection.getSocket();
      await socket.sendMessage(chatJid, { sticker: result.buffer }, { quoted: message });
      await this.react(message, chatJid, '✅');

      this.logger.info(
        {
          chatSuffix: chatJid.slice(chatJid.indexOf('@')),
          bytes: result.bytes,
          quality: result.quality,
          hasText: Boolean(text),
        },
        'Stiker terkirim',
      );
      return true;
    } catch (error) {
      await this.react(message, chatJid, '❌');
      const userMessage =
        error instanceof UserFacingError
          ? error.message
          : 'Gagal membuat stiker. Coba kirim fotonya lagi.';

      this.logger.error(
        { err: error, messageId: message.key?.id, chat: chatJid.slice(chatJid.indexOf('@')) },
        'Gagal membuat stiker',
      );
      await this.reply(chatJid, userMessage, message);
      return false;
    }
  }

  private async downloadImage(image: ImageMessage): Promise<Buffer> {
    const stream = await downloadContentFromMessage(image, 'image');
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;

      if (total > this.config.maxImageBytes) {
        throw new UserFacingError(
          `Ukuran foto terlalu besar. Maksimal ${Math.floor(
            this.config.maxImageBytes / 1024 / 1024,
          )} MB.`,
        );
      }

      chunks.push(buffer);
    }

    if (chunks.length === 0) {
      throw new UserFacingError('Gagal mengunduh foto.');
    }

    return Buffer.concat(chunks);
  }

  private setPending(chatJid: string, image: ImageMessage, message: WAMessage): void {
    this.pending.set(chatJid, {
      image,
      message,
      expiresAt: Date.now() + PENDING_TTL_MS,
    });
  }

  private sweepPending(): void {
    const now = Date.now();

    for (const [chatJid, pending] of this.pending) {
      if (pending.expiresAt <= now) {
        this.pending.delete(chatJid);
      }
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
