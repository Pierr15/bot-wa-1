import type { WAMessage, WAMessageContent } from 'baileys';
import type { AppConfig } from '../config.js';
import type { AppLogger } from '../core/logger.js';
import { errorMessage } from '../core/errors.js';
import { stats } from '../core/stats.js';
import { detectLinks } from '../downloader/detect.js';
import { isBroadcastJid, isGroupJid, isNewsletterJid } from '../utils/phone.js';
import { AccessControl } from './access.js';
import type { BotConnection } from './connection.js';
import { AdminHandler } from './handlers/admin.js';
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

const STICKER_COMMANDS = new Set(['s', 'stiker', 'sticker']);

export class MessageRouter {
  private readonly access: AccessControl;
  private readonly sticker: StickerHandler;
  private readonly downloader: DownloaderHandler;
  private readonly admin: AdminHandler;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly connection: BotConnection,
  ) {
    this.access = new AccessControl(config, logger);
    this.sticker = new StickerHandler(config, logger, connection);
    this.downloader = new DownloaderHandler(config, logger, connection);
    this.admin = new AdminHandler(config, logger, connection);
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

    // Media only becomes a sticker when the caption (or the reply to it) carries .s/.sticker.
    if (content.imageMessage || content.videoMessage) {
      const caption = parseCommand(text);

      if (caption && STICKER_COMMANDS.has(caption.command)) {
        await this.sticker.handleStickerCommand(message, chatJid, content, caption.args);
      } else {
        await this.sticker.sendHint(chatJid, message);
      }
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
      // Downloading can take a minute; do not block commands behind it.
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

    if (getQuotedMessage(content)?.imageMessage || getQuotedMessage(content)?.videoMessage) {
      await this.sticker.sendHint(chatJid, message);
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
      case 's':
      case 'stiker':
      case 'sticker':
        stats.record(`cmd_${command}`);
        await this.sticker.handleStickerCommand(message, chatJid, content, args);
        return;

      case 't':
      case 'teks':
        stats.record(`cmd_${command}`);
        await this.sticker.handleTextCommand(message, chatJid, args);
        return;

      case 'v':
        stats.record('cmd_v');
        await this.downloader.handleChoice(message, chatJid, 'video');
        return;

      case 'a':
        stats.record('cmd_a');
        await this.downloader.handleChoice(message, chatJid, 'audio');
        return;

      case 'f':
      case 'foto':
        stats.record('cmd_f');
        await this.downloader.handleChoice(message, chatJid, 'image', args);
        return;

      case 'menu':
      case 'help':
      case 'start':
        stats.record(`cmd_${command}`);
        await this.reply(chatJid, buildMenu(this.config, isOwner), message);
        return;

      case 'ping':
        stats.record('cmd_ping');
        await this.reply(chatJid, `pong • ${Math.floor(process.uptime())}s`, message);
        return;

      case 'id':
        stats.record('cmd_id');
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

      case 'stat':
      case 'status':
        stats.record('cmd_stat');
        if (!isOwner) {
          await this.reply(chatJid, 'Perintah ini khusus owner.', message);
          return;
        }

        await this.reply(chatJid, await this.admin.stat(), message);
        return;

      case 'broadcast':
      case 'bc':
        stats.record('cmd_broadcast');
        if (!isOwner) {
          await this.reply(chatJid, 'Perintah ini khusus owner.', message);
          return;
        }

        await this.admin.broadcast(message, chatJid, args);
        return;

      default:
        await this.reply(
          chatJid,
          `Perintah \`.${command}\` tidak dikenal. Ketik .menu untuk melihat daftar fitur.`,
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
