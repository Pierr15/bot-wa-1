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
    const image =
      content.imageMessage ?? getQuotedMessage(content)?.imageMessage ?? null;

    if (!image) {
      await this.reply(
        chatJid,
        'Kirim foto dengan caption `.s` untuk membuat stiker, atau reply foto Anda dengan `.s`.',
        message,
      );
      return;
    }

    const trimmed = args.trim();

    if (!trimmed) {
      await this.generate(message, chatJid, image, null);
      return;
    }

    const zones = this.parseOrReply(trimmed, chatJid, message);

    if (!zones) {
      return;
    }

    await this.generate(message, chatJid, image, zones);
  }

  async sendHint(chatJid: string, message: WAMessage): Promise<void> {
    await this.reply(
      chatJid,
      'Foto ini belum diproses. Reply foto dengan `.s` atau `.sticker` untuk menjadikannya stiker.\n\n' +
        '• `.s` — stiker polos\n' +
        '• `.s KEREN` — stiker dengan teks di bawah\n' +
        '• `.s KEREN | HALO` — teks dua zona (kiri bawah, kanan atas)',
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
