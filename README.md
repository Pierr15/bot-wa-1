# Bot WhatsApp — Stiker & Downloader

Bot privat untuk WhatsApp yang berjalan di Termux (Android). Fase 1 mendukung:

- foto + caption → stiker WebP 512×512 (≤100 KB), teks putih dengan outline hitam;
- posisi teks `atas:`, `bawah:`, `tengah:`, dan dua zona `atas: A | bawah: B`;
- foto tanpa caption → bot menunggu teks (5 menit), `/skip` untuk stiker polos;
- download TikTok/Instagram tanpa watermark, termasuk foto dan carousel/slideshow.

## Kebutuhan

- Node.js 22/24 LTS
- `yt-dlp`, `ffmpeg`, dan `ffprobe`
- Termux dari F-Droid dengan arsitektur `aarch64`
- Nomor WhatsApp khusus bot (disarankan), ditautkan sebagai perangkat tertaut

## Setup

```bash
pkg install -y nodejs-lts git ffmpeg python termux-services
pip install -U yt-dlp

git clone <repo-url> ~/bot-wa-1
cd ~/bot-wa-1
npm ci --allow-git=all
cp .env.example .env
# edit .env: isi OWNER_NUMBERS / ALLOWED_NUMBERS
npm run build
npm start
```

Saat pertama kali dijalankan dengan `LOGIN_MODE=qr`, QR akan tampil di terminal dan
disimpan sementara di `data/qr.txt`. Scan dari WhatsApp di HP nomor bot:
**Perangkat tertaut → Tautkan perangkat**.

Jika WhatsApp dan Termux berada di HP yang sama, gunakan `LOGIN_MODE=pairing` dan isi
`BOT_PHONE_NUMBER`. Kode pairing akan ditampilkan di terminal.

## Konfigurasi Penting

| Variabel                    | Default                      | Keterangan                                    |
| --------------------------- | ---------------------------- | --------------------------------------------- |
| `OWNER_NUMBERS`             | kosong                       | Nomor owner, pisahkan dengan koma             |
| `ALLOWED_NUMBERS`           | kosong                       | Whitelist nomor lain                          |
| `LOGIN_MODE`                | `qr`                         | `qr` atau `pairing`                           |
| `DOWNLOAD_MAX_MB`           | `16`                         | Batas media yang dikirim sebagai video/gambar |
| `DOWNLOAD_SOURCE_MAX_MB`    | `100`                        | Batas file sumber dari yt-dlp                 |
| `DOWNLOAD_MAX_DURATION_SEC` | `300`                        | Durasi video maksimal                         |
| `MIN_FREE_DISK_MB`          | `1024`                       | Tolak download jika sisa disk di bawah batas  |
| `ENABLE_TIKWM_FALLBACK`     | `true`                       | Fallback TikTok lewat pihak ketiga            |
| `IG_COOKIES_PATH`           | `data/cookies/instagram.txt` | Cookies Netscape untuk Instagram              |

Jika `OWNER_NUMBERS` dan `ALLOWED_NUMBERS` kosong, semua pesan diabaikan.

## Perintah

- `/menu` — menu bantuan
- `/ping` — cek bot hidup
- `/skip` — buat stiker polos saat menunggu teks
- `/batal` — batalkan stiker yang menunggu teks
- `/id` — lihat ID chat (owner)

## Downloader

- Link yang didukung: post/video/photo TikTok dan post/reel/carousel Instagram.
- Domain dicek dengan allowlist; profil dan hashtag tidak diproses.
- yt-dlp dipanggil tanpa shell, dengan timeout, batas ukuran, dan output unik di `data/tmp`.
- Video yang lebih besar dari 16 MB dikompres ke H.264/AAC (720p → 480p → 360p);
  jika masih terlalu besar, dikirim sebagai dokumen.
- TikTok memakai selector yang menghindari format berlabel watermark. Jika gagal dan
  `ENABLE_TIKWM_FALLBACK=true`, link dikirim ke TikWM. Matikan fallback ini jika tidak
  ingin link keluar ke pihak ketiga.
- Instagram membutuhkan cookies untuk konten yang mengharuskan login. Export cookies
  dalam format Netscape ke path `IG_COOKIES_PATH`; jangan commit file tersebut.

Cara export cookies Instagram:

1. Login ke akun burner di browser desktop.
2. Pasang ekstensi export cookies (misalnya "Get cookies.txt LOCALLY").
3. Export cookies untuk `instagram.com` dalam format Netscape.
4. Simpan sebagai `data/cookies/instagram.txt` (atau sesuai `IG_COOKIES_PATH`).
5. Pastikan file diawali `# Netscape HTTP Cookie File` dan hanya bisa dibaca user bot:
   `chmod 600 data/cookies/instagram.txt`.

Cookies adalah kredensial penuh akun. Jangan kirim ke siapa pun dan export ulang jika
Instagram menampilkan login wall.

- Batas: TikTok 3 download/5 menit/user, Instagram 2 download/10 menit/user,
  maksimal 10 media per post, antrean download serial.
- Download ditolak jika sisa penyimpanan di bawah `MIN_FREE_DISK_MB`.

## Service 24/7 di Termux

Setelah `.env` diisi, build selesai, dan login WhatsApp berhasil:

```bash
cd ~/bot-wa-1
bash scripts/termux/install-service.sh
```

Script memasang service `wa-bot`, log, dan boot script Termux:Boot. Perintah operasional:

```bash
sv status wa-bot
sv restart wa-bot
sv down wa-bot
tail -f ~/.local/share/wa-bot/log/current
```

Jika `sv up` gagal karena daemon service belum berjalan, tutup-buka Termux lalu jalankan
`sv up wa-bot`. Pastikan Termux:Boot sudah dibuka sekali dan optimasi baterai Termux
dimatikan.

## Pengembangan

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke:native   # cek native module di perangkat
```

File sementara disimpan di `data/tmp` dan dibersihkan otomatis setiap 15 menit untuk
file yang lebih lama dari 6 jam. Folder `data/` tidak di-commit.

## Catatan Keamanan

- Ini menggunakan Baileys (WhatsApp Web protocol), bukan API resmi. Ada risiko akun
  dibatasi/ban. Gunakan nomor khusus dan whitelist.
- Jangan commit `.env`, `data/auth`, atau cookies Instagram.
- Jangan jalankan bot di HP yang menyimpan data sensitif tanpa pemahaman risikonya.

Runbook Termux lengkap, termasuk Termux:Boot dan `termux-services`, ada di `TODO.md`.

## Troubleshooting

- **`EALLOWGIT` saat `npm ci`** — pastikan `.npmrc` berisi `allow-git=all`, atau jalankan
  `npm ci --allow-git=all` (Baileys memakai dependency dari Git).
- **Native module gagal dimuat** — jalankan `npm run smoke:native`. Arsitektur harus
  `aarch64`; jangan memakai Termux dari Play Store.
- **Bot tidak membalas** — cek `OWNER_NUMBERS`/`ALLOWED_NUMBERS`, pastikan chat pribadi
  (grup memang belum aktif), dan cek log.
- **Download gagal** — pastikan `yt-dlp`, `ffmpeg`, dan `ffprobe` ada di `PATH`; perbarui
  yt-dlp dengan `pip install -U yt-dlp`. Untuk Instagram, export ulang cookies.
- **TikTok gagal terus** — coba `ENABLE_TIKWM_FALLBACK=true`; fallback ini mengirim link
  ke TikWM.
- **QR kedaluwarsa** — jalankan ulang bot. Jangan hapus `data/auth` kecuali sesi sudah
  logout dan ingin pairing ulang.
