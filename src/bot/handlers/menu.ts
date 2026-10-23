import type { AppConfig } from '../../config.js';

export function baseMenu(config: AppConfig): string {
  return [
    `*${config.botName}*`,
    '',
    '*Stiker*',
    'Kirim foto dengan caption `.s` → stiker polos.',
    '`.s KEREN` → teks di bawah; `.s | KEREN` → teks di atas.',
    '`.s TEKS BAWAH | TEKS ATAS` → teks dua zona.',
    'Video/GIF dikirim dengan `.s` → stiker animasi ' +
      `(${config.sticker.animMaxSeconds} detik pertama).`,
    'Media tanpa `.s` tidak diproses — reply foto/video dengan `.s`.',
    '',
    '*Stiker Teks*',
    '`.t KEREN` — stiker teks di dasar putih.',
    '`.t | KEREN` — teks di atas.',
    '',
    '*Downloader*',
    'Kirim link TikTok/Instagram untuk unduh media tanpa watermark.',
    'Reply hasil download:',
    '`.v` — video full-res, `.a` — audio saja',
    '`.f` — semua foto, `.f 3` — foto ke-3 saja',
    '',
    '*Perintah*',
    '`.s` / `.t` — stiker · `.menu` — menu ini',
    '`.ping` — cek bot hidup',
  ].join('\n');
}

export function buildMenu(config: AppConfig, isOwner: boolean): string {
  if (!isOwner) {
    return [baseMenu(config), '', 'Bot ini privat: hanya nomor yang diizinkan yang dilayani.'].join(
      '\n',
    );
  }

  return [
    baseMenu(config),
    '',
    '*Owner*',
    '`.stat` — uptime, memori, disk, statistik penggunaan',
    '`.id` — ID chat (debug)',
    '`.broadcast <teks>` — siarkan ke semua nomor terdaftar',
  ].join('\n');
}
