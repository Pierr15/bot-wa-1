import type { AppConfig } from '../../config.js';

export function buildMenu(config: AppConfig): string {
  return [
    `*${config.botName}*`,
    '',
    '*Stiker*',
    'Kirim foto dengan caption untuk menjadikannya stiker.',
    'Contoh: foto + caption `KEREN BANGET`',
    'Posisi teks: `atas: TEKS`, `bawah: TEKS`, atau `tengah: TEKS`.',
    'Dua zona: `atas: TEKS 1 | bawah: TEKS 2`.',
    'Kirim foto tanpa caption, lalu balas teksnya. Ketik `/skip` untuk tanpa teks.',
    '',
    '*Downloader*',
    'Kirim link TikTok atau Instagram untuk mengunduh tanpa watermark.',
    'Mendukung video, foto, dan carousel/slideshow (maks 10 media).',
    'Video maksimal 5 menit; video besar dikompres otomatis.',
    '',
    '*Perintah*',
    '`/menu` — tampilkan menu',
    '`/ping` — cek bot hidup',
    '`/skip` — stiker tanpa teks',
    '`/batal` — batalkan menunggu teks',
    '`/id` — lihat ID chat (khusus owner)',
    '',
    'Bot ini privat: hanya nomor yang diizinkan yang dilayani.',
  ].join('\n');
}
