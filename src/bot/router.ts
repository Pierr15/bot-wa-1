import type { WAMessage, WAMessageContent } from 'baileys';
import type { AppConfig } from '../config.js';
import type { AppLogger } from '../core/logger.js';
import { errorMessage } from '../core/errors.js';
import { detectLinks } from '../downloader/detect.js';
import { isBroadcastJid, isGroupJid, isNewsletterJid } from '../utils/phone.js';
import { AccessControl } from './access.js';
import type { BotConnection } from './connection.js';
import { DownloaderHandler } from './handlers/downloader.js';
import { buildMenu } from './handlers/menu.js';
import { StickerHandler } from './handlers/sticker.js';
import { getMessageText, getQuotedMessage, parseCommand, unwrapMessage } from './messages.js';

function maskJid(jid: string): string {
  const [user, server] = jid.split('@');
  if (!user || !server) {
    return jid;
  }

  const masked = user.length <= 4 ? '***' : `${user.slice(0, 2)}***${user.slice(-2)}`;
  return `${masked}@${server}`;
}

export class MessageRouter {
  private readonly access: AccessControl;
  private readonly sticker: StickerHandler;
  private readonly downloader: DownloaderHandler;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly connection: BotConnection,
  ) {
    this.access = new AccessControl(config, logger);
    this.sticker = new StickerHandler(config, logger, connection);
    this.downloader = new DownloaderHandler(config, logger, connection);
  }

  async initialize(): Promise<void> {
    await this.downloader.initialize();
  }

  stop(): void {
    this.sticker.stop();
    this.downloader.stop();
  }

  async handle(messages: WAMessage[]): Promise<void> {
    for (const message of messages) {
      try {
        await this.handleOne(message);
      } catch (error) {
        this.logger.error(
          { err: error, messageId: message.key?.id },
          'Gagal memproses pesan masuk',
        );
        await this.safeReply(
          message.key?.remoteJid,
          'Maaf, terjadi kesalahan saat memproses pesan. Coba lagi sebentar lagi.',
          message,
        );
      }
    }
  }

  private async handleOne(message: WAMessage): Promise<void> {
    const chatJid = message.key?.remoteJid;

    if (!chatJid || isBroadcastJid(chatJid) || isNewsletterJid(chatJid)) {
      return;
    }

    if (isGroupJid(chatJid)) {
      this.logger.debug({ chat: maskJid(chatJid) }, 'Grup belum diaktifkan pada fase ini');
      return;
    }

    const access = this.access.check(message.key, chatJid);

    if (!access.allowed) {
      return;
    }

    const content = unwrapMessage(message.message);

    if (!content) {
      return;
    }

    const text = getMessageText(content)?.trim() ?? '';

    // A direct image is always sticker input, even if its caption looks like a command.
    if (content.imageMessage) {
      await this.sticker.handleIncoming(message, chatJid, content, text);
      return;
    }

    const command = parseCommand(text);

    if (command) {
      await this.handleCommand(
        message,
        chatJid,
        command.command,
        command.args,
        access.isOwner,
        content,
      );
      return;
    }

    const links = detectLinks(text);

    if (links.length > 0) {
      this.sticker.clearPending(chatJid);

      // Downloading can take a minute; do not block stickers or commands behind it.
      void this.downloader
        .handle(message, chatJid, links, access.senderPhones[0] ?? chatJid, access.isOwner)
        .catch((error: unknown) => {
          this.logger.error(
            { err: error, error: errorMessage(error) },
            'Download gagal di luar handler',
          );
        });
      return;
    }

    if (await this.sticker.handlePendingText(message, chatJid, text)) {
      return;
    }

    if (getQuotedMessage(content)?.imageMessage) {
      await this.sticker.handleIncoming(message, chatJid, content, text);
    }
  }

  private async handleCommand(
    message: WAMessage,
    chatJid: string,
    command: string,
    args: string,
    isOwner: boolean,
    content: WAMessageContent,
  ): Promise<void> {
    this.logger.debug({ command, chat: maskJid(chatJid) }, 'Command diterima');

    switch (command) {
      case 'stiker':
      case 'sticker':
        await this.sticker.handleStickerCommand(message, chatJid, content, args);
        return;

      case 'skip':
        await this.sticker.skip(chatJid, message);
        return;

      case 'batal':
      case 'cancel':
        await this.sticker.cancel(chatJid, message);
        return;

      case 'menu':
      case 'help':
      case 'start':
        await this.reply(chatJid, buildMenu(this.config), message);
        return;

      case 'ping':
        await this.reply(chatJid, `pong • ${Math.floor(process.uptime())}s`, message);
        return;

      case 'id':
        if (!isOwner) {
          await this.reply(chatJid, 'Perintah ini khusus owner.', message);
          return;
        }

        await this.reply(
          chatJid,
          [
            `Chat JID: \`${chatJid}\``,
            `Sender PN: \`${message.key.remoteJidAlt ?? '-'}\``,
            `Participant: \`${message.key.participant ?? '-'}\``,
            `Participant Alt: \`${message.key.participantAlt ?? '-'}\``,
          ].join('\n'),
          message,
        );
        return;

      default:
        await this.reply(
          chatJid,
          `Perintah \`/${command}\` tidak dikenal. Ketik /menu untuk melihat daftar fitur.`,
          message,
        );
        return;
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

  private async safeReply(
    chatJid: string | null | undefined,
    text: string,
    quoted?: WAMessage,
  ): Promise<void> {
    if (!chatJid) {
      return;
    }

    try {
      await this.reply(chatJid, text, quoted);
    } catch (error) {
      this.logger.warn({ err: error, error: errorMessage(error) }, 'Gagal mengirim balasan');
    }
  }
}
