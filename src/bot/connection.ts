import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type ConnectionState,
  type WAMessage,
  type WASocket,
} from 'baileys';
import * as qrcode from 'qrcode-terminal';
import type { AppConfig } from '../config.js';
import type { AppLogger } from '../core/logger.js';
import { TtlSet } from '../core/ttl-set.js';

export type MessagesListener = (messages: WAMessage[]) => Promise<void>;

function maskPhone(phone: string): string {
  if (phone.length <= 6) {
    return '***';
  }

  return `${phone.slice(0, 2)}****${phone.slice(-2)}`;
}

export class BotConnection {
  private socket: WASocket | null = null;
  private running = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pairingTimer: NodeJS.Timeout | null = null;
  private pairingRequested = false;
  private readonly processed = new TtlSet(10 * 60_000);
  private readonly qrFile: string;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly onMessages: MessagesListener,
  ) {
    this.qrFile = path.join(config.paths.dataDir, 'qr.txt');
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pairingTimer) {
      clearTimeout(this.pairingTimer);
      this.pairingTimer = null;
    }

    const socket = this.socket;
    this.socket = null;

    if (socket) {
      try {
        await socket.end(new Error('Bot shutdown'));
      } catch (error) {
        this.logger.debug({ err: error }, 'Gagal menutup socket dengan rapi');
      }
    }
  }

  getSocket(): WASocket {
    if (!this.socket) {
      throw new Error('Socket WhatsApp belum siap');
    }

    return this.socket;
  }

  private async connect(): Promise<void> {
    if (!this.running) {
      return;
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.config.paths.authDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    this.logger.info({ version, isLatest }, 'Menyiapkan koneksi WhatsApp');

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger),
      },
      logger: this.logger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
      shouldIgnoreJid: (jid) => jid === 'status@broadcast' || jid.endsWith('@newsletter'),
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 30_000,
      retryRequestDelayMs: 1_000,
    });

    this.socket = socket;
    this.pairingRequested = false;

    socket.ev.on('creds.update', () => {
      void saveCreds().catch((error: unknown) => {
        this.logger.error({ err: error }, 'Gagal menyimpan kredensial WhatsApp');
      });
    });

    socket.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(update).catch((error: unknown) => {
        this.logger.error({ err: error }, 'Error saat menangani status koneksi');
      });
    });

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') {
        return;
      }

      void this.handleMessages(messages).catch((error: unknown) => {
        this.logger.error({ err: error }, 'Error saat memproses pesan masuk');
      });
    });

    if (
      !state.creds.registered &&
      this.config.loginMode === 'pairing' &&
      this.config.botPhoneNumber
    ) {
      this.pairingTimer = setTimeout(() => {
        void this.requestPairingCode(socket).catch((error: unknown) => {
          this.logger.error({ err: error }, 'Gagal membuat kode pairing');
        });
      }, 3_000);
      this.pairingTimer.unref();
    }
  }

  private async requestPairingCode(socket: WASocket): Promise<void> {
    if (this.pairingRequested || !this.config.botPhoneNumber) {
      return;
    }

    this.pairingRequested = true;
    const code = await socket.requestPairingCode(this.config.botPhoneNumber);
    const formatted = code.match(/.{1,4}/gu)?.join('-') ?? code;

    console.log(
      [
        '',
        '========================================',
        ' KODE PAIRING WHATSAPP',
        ` ${formatted}`,
        '========================================',
        ' Buka WhatsApp di HP nomor bot:',
        ' Perangkat tertaut > Tautkan perangkat >',
        ' Tautkan dengan nomor telepon, lalu masukkan kode di atas.',
        '',
      ].join('\n'),
    );

    this.logger.info(
      { phone: maskPhone(this.config.botPhoneNumber) },
      'Kode pairing dibuat; masukkan di WhatsApp',
    );
  }

  private async handleConnectionUpdate(update: Partial<ConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (this.config.loginMode === 'qr') {
        qrcode.generate(qr, { small: true }, (ascii) => {
          console.log(`\n${ascii}\n`);
          void writeFile(this.qrFile, ascii, 'utf8').catch((error: unknown) => {
            this.logger.debug({ err: error }, 'Gagal menyimpan QR ke file');
          });
        });
        this.logger.info(
          { file: this.qrFile },
          'Scan QR dengan WhatsApp > Perangkat tertaut > Tautkan perangkat',
        );
      } else {
        this.logger.info('Menunggu kode pairing dimasukkan di WhatsApp');
      }
    }

    if (connection === 'open') {
      this.reconnectAttempt = 0;
      this.logger.info({ user: this.socket?.user?.id }, 'WhatsApp terhubung');
      void rm(this.qrFile, { force: true }).catch(() => undefined);
      return;
    }

    if (connection !== 'close') {
      return;
    }

    const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
      ?.output?.statusCode;

    this.socket = null;

    if (!this.running) {
      return;
    }

    if (statusCode === DisconnectReason.loggedOut) {
      this.running = false;
      this.logger.error(
        'Sesi WhatsApp logout. Hapus data/auth lalu jalankan ulang bot untuk pairing baru.',
      );
      return;
    }

    if (
      statusCode === DisconnectReason.forbidden ||
      statusCode === DisconnectReason.connectionReplaced ||
      statusCode === DisconnectReason.multideviceMismatch
    ) {
      this.running = false;
      this.logger.error({ statusCode }, 'Koneksi dihentikan permanen oleh WhatsApp');
      return;
    }

    this.scheduleReconnect(statusCode);
  }

  private scheduleReconnect(statusCode?: number): void {
    if (!this.running || this.reconnectTimer) {
      return;
    }

    const attempt = this.reconnectAttempt;
    this.reconnectAttempt += 1;

    const baseDelay = Math.min(60_000, 2_000 * 2 ** Math.min(attempt, 5));
    const delay = baseDelay + Math.floor(Math.random() * 1_000);

    this.logger.warn({ delay, statusCode, attempt }, 'Koneksi terputus; mencoba menyambung ulang');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error: unknown) => {
        this.logger.error({ err: error }, 'Gagal menyambung ulang');
        this.scheduleReconnect();
      });
    }, delay);

    this.reconnectTimer.unref();
  }

  private async handleMessages(messages: WAMessage[]): Promise<void> {
    const fresh: WAMessage[] = [];

    for (const message of messages) {
      const id = message.key?.id;
      const remoteJid = message.key?.remoteJid;

      if (!id || !remoteJid || message.key.fromMe) {
        continue;
      }

      if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) {
        continue;
      }

      if (!this.processed.add(`${remoteJid}:${id}`)) {
        continue;
      }

      fresh.push(message);
    }

    if (fresh.length > 0) {
      await this.onMessages(fresh);
    }
  }
}
