import type { AppConfig } from '../../config.js';

export function buildMenu(config: AppConfig): string {
  return [
    `*${config.botName}*`,
    '',
    '*Stiker*',
    'Kirim foto dengan caption `.s` atau `.sticker` untuk menjadikannya stiker.',
    '`.s` — stiker polos tanpa teks.',
    '`.s KEREN` — stiker dengan teks.',
    'Posisi teks: `atas: TEKS`, `bawah: TEKS`, atau `tengah: TEKS`.',
    'Dua zona: `.s atas: TEKS 1 | bawah: TEKS 2`.',
    'Foto tanpa caption `.s` tidak diproses; reply foto dengan `.s` untuk memprosesnya.',
    '',
    '*Downloader*',
    'Kirim link TikTok atau Instagram untuk mengunduh tanpa watermark.',
    'Mendukung video, foto, dan carousel/slideshow (maks 10 media).',
    'Video maksimal 5 menit; video besar dikompres otomatis.',
    '',
    '*Perintah*',
    '`.s` / `.sticker` — buat stiker dari foto (caption atau reply)',
    '`.menu` — tampilkan menu',
    '`.ping` — cek bot hidup',
    '`.id` — lihat ID chat (khusus owner)',
    '',
    'Bot ini privat: hanya nomor yang diizinkan yang dilayani.',
  ].join('\n');
}
