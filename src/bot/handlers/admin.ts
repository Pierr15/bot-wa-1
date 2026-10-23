import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WAMessage } from 'baileys';
import { promisify } from 'node:util';
import type { AppConfig } from '../../config.js';
import { errorMessage } from '../../core/errors.js';
import type { AppLogger } from '../../core/logger.js';
import { stats } from '../../core/stats.js';
import { getFreeDiskBytes } from '../../core/storage.js';
import { formatBytes } from '../../downloader/media.js';
import type { BotConnection } from '../connection.js';

const execFileAsync = promisify(execFile);

const BROADCAST_DELAY_MS = 800;
const BROADCAST_MAX_CHARS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatUptime(seconds: number): string {
  const wholeDays = Math.floor(seconds / 86_400);
  const wholeHours = Math.floor((seconds % 86_400) / 3_600);
  const wholeMinutes = Math.floor((seconds % 3_600) / 60);
  const parts: string[] = [];

  if (wholeDays > 0) {
    parts.push(`${wholeDays} hari`);
  }

  if (wholeHours > 0) {
    parts.push(`${wholeHours} jam`);
  }

  if (wholeMinutes > 0 && wholeDays === 0) {
    parts.push(`${wholeMinutes} menit`);
  }

  if (parts.length === 0) {
    parts.push(`${Math.floor(seconds)} detik`);
  }

  return parts.join(' ');
}

export class AdminHandler {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly connection: BotConnection,
  ) {}

  async stat(): Promise<string> {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    const freeBytes = await getFreeDiskBytes(this.config.paths.tmpDir);
    const tmp = await this.summarizeTmpDir();
    const commit = await this.currentCommit();
    const counters = stats.snapshot();

    const usage = Object.entries(counters)
      .filter(([key]) => key.startsWith('cmd_'))
      .map(([key, value]) => `.${key.slice(4)} ${value}×`)
      .sort((a, b) => a.localeCompare(b, 'id'))
      .join(', ');

    return [
      '*Status Bot*',
      '',
      `Uptime : ${formatUptime(uptime)}`,
      `Memori : ${(memory.rss / 1024 / 1024).toFixed(1)} MB RSS`,
      `Disk   : sisa ${freeBytes === null ? 'tidak bisa dibaca' : formatBytes(freeBytes)}`,
      `data/tmp: ${tmp.count} file / ${formatBytes(tmp.bytes)}`,
      `Commit : ${commit}`,
      '',
      `Stiker : ${counters.stiker ?? 0} sukses / ${counters.stiker_gagal ?? 0} gagal`,
      `Download: ${counters.download ?? 0} sukses / ${counters.download_gagal ?? 0} gagal`,
      usage ? `Command: ${usage}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async broadcast(message: WAMessage, chatJid: string, args: string): Promise<void> {
    const text = args.trim();

    if (!text) {
      await this.reply(
        chatJid,
        'Kirim teksnya juga. Contoh: `.broadcast Maintenance malam ini jam 1.`',
        message,
      );
      return;
    }

    if (text.length > BROADCAST_MAX_CHARS) {
      await this.reply(
        chatJid,
        `Teks broadcast maksimal ${BROADCAST_MAX_CHARS} karakter.`,
        message,
      );
      return;
    }

    const targets = [...new Set([...this.config.ownerNumbers, ...this.config.allowedNumbers])]
      .filter((phone) => phone !== this.config.botPhoneNumber)
      .map((phone) => `${phone}@s.whatsapp.net`);

    if (targets.length === 0) {
      await this.reply(
        chatJid,
        'Tidak ada nomor target. Isi OWNER_NUMBERS atau ALLOWED_NUMBERS di .env.',
        message,
      );
      return;
    }

    const socket = this.connection.getSocket();
    let sent = 0;
    let failed = 0;

    for (const target of targets) {
      try {
        await socket.sendPresenceUpdate('paused', target).catch(() => undefined);
        await socket.sendMessage(target, { text: `*Broadcast*\n\n${text}` });
        sent += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          { err: error, error: errorMessage(error), targetSuffix: target.slice(target.indexOf('@')) },
          'Gagal mengirim broadcast',
        );
      }

      await delay(BROADCAST_DELAY_MS);
    }

    stats.record('broadcast_terkirim', sent);
    stats.record('broadcast_gagal', failed);
    await this.reply(chatJid, `Broadcast selesai: ${sent} terkirim${failed ? `, ${failed} gagal` : ''}.`, message);
  }

  private async summarizeTmpDir(): Promise<{ count: number; bytes: number }> {
    let count = 0;
    let bytes = 0;

    const addFile = async (filePath: string): Promise<void> => {
      try {
        const info = await stat(filePath);
        if (info.isFile()) {
          count += 1;
          bytes += info.size;
        }
      } catch {
        // File can vanish between listing and stat; ignore.
      }
    };

    try {
      const entries = await readdir(this.config.paths.tmpDir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(this.config.paths.tmpDir, entry.name);

        if (entry.isDirectory()) {
          const nested = await readdir(entryPath, { withFileTypes: true });

          for (const child of nested) {
            if (child.isFile()) {
              await addFile(path.join(entryPath, child.name));
            }
          }
        } else {
          await addFile(entryPath);
        }
      }
    } catch {
      // tmp dir may not exist yet.
    }

    return { count, bytes };
  }

  private async currentCommit(): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: process.cwd(),
        timeout: 10_000,
      });

      return stdout.trim();
    } catch {
      return 'belum ada';
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
