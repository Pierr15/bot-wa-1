# TODO — Bot WhatsApp Fase 1

**Status:** M0–M4 sudah diimplementasikan (kode); acceptance perangkat/Termux dan uji link nyata belum dijalankan.
**Target runtime:** HP Android cadangan → Termux (arm64)  
**Lingkungan development:** Windows, `D:\Project\bot-wa-1`  
**Nomor WhatsApp:** nomor baru (bot), terpisah dari nomor pribadi  
**Mode awal:** chat pribadi + whitelist nomor; grup menyusul  
**Akun Instagram khusus:** tersedia

---

## 0. Keputusan teknis yang sudah dikunci

- [x] WhatsApp: **Baileys 6.7.24** (versi stabil; v7 masih RC).
- [x] Runtime: **Node.js 22 LTS** di Windows dan Termux.
- [x] Image processing: **`@napi-rs/image`** — punya prebuilt `android-arm64`, dukung resize/crop/rotate EXIF/WebP dengan quality.
- [x] Text overlay: **`@napi-rs/canvas`** — punya prebuilt `android-arm64`, tanpa system dependency.
- [x] **Tidak memakai `sharp`** karena tidak ada prebuilt `android-arm64`; kompilasi manual di Termux rapuh dan sering rusak setelah update.
- [x] Downloader: **yt-dlp** + **ffmpeg**.
- [x] Service manager: **termux-services** (runit) + **Termux:Boot** + `termux-wake-lock`.
- [x] Stiker: WebP **512×512**, **≤100 KB**, gaya meme Indonesia.
- [x] Privasi: media user hanya di `data/tmp`, dihapus setelah dikirim.

### Kontingensi jika native module gagal di Termux

- [ ] Jika `@napi-rs/image` atau `@napi-rs/canvas` gagal load di perangkat:
  - Opsi A: jalankan bot di **proot-distro Debian** (glibc), lalu install dependency Linux biasa.
  - Opsi B: render teks dengan canvas, encode WebP lewat **ffmpeg/libwebp**.
  - Opsi C: cek apakah perangkat 32-bit; jika ya, ganti pipeline image dengan alternatif pure-JS/WASM.
- [ ] Keputusan fallback hanya diambil setelah gate M0 diuji di HP.

---

## Gate 0 — Validasi lingkungan sebelum menulis fitur

Wajib lulus semua. Jika gagal, selesaikan dulu sebelum lanjut.

- [ ] **G0.1** Konfirmasi HP: `uname -m` harus `aarch64`; catat versi Android, RAM, dan ruang penyimpanan.
- [ ] **G0.2** Install **Termux dari F-Droid** (jangan campur dengan versi Play Store).
- [ ] **G0.3** Install **Termux:Boot** dari F-Droid, buka aplikasinya sekali.
- [ ] **G0.4** Matikan optimasi baterai untuk Termux dan Termux:Boot.
- [ ] **G0.5** `pkg update && pkg upgrade -y`.
- [ ] **G0.6** Install dependency: `pkg install -y nodejs-lts git ffmpeg python termux-services openssh`.
- [ ] **G0.7** Install/update yt-dlp: `pip install -U yt-dlp`; verifikasi `yt-dlp --version`.
- [ ] **G0.8** Verifikasi `node -v` (22.x), `npm -v`, `ffmpeg -version`.
- [ ] **G0.9** Smoke test native module:
  - install `@napi-rs/image` + `@napi-rs/canvas`;
  - decode foto, resize/crop 512×512, encode WebP q80;
  - pastikan hasil **≤100 KB** dan file WebP valid.
- [ ] **G0.10** Smoke test Baileys: konek, kirim `ping` → `pong`, lalu restart tanpa scan ulang.
- [ ] **G0.11** Login bot memakai **pairing code** (bukan QR) jika WhatsApp dan Termux berada di HP yang sama.
- [ ] **G0.12** Test `yt-dlp` + `ffmpeg` pada satu video TikTok publik dan satu Reel Instagram.
- [ ] **G0.13** Test `termux-wake-lock`, lalu pastikan proses tetap hidup saat layar mati 15 menit.
- [ ] **G0.14** Test Termux:Boot + service runit: reboot HP → bot hidup tanpa membuka Termux.
- [ ] **G0.15** Catat suhu/baterai setelah 30 menit idle; pastikan tidak overheat.

**Gate lulus jika:** native module jalan, Baileys stabil, downloader dasar jalan, dan bot auto-start setelah reboot.

---

## M0 — Fondasi repo dan koneksi

- [x] **M0.1** `git init`, buat `package.json`, `tsconfig.json`, ESLint, Prettier, Vitest.
- [x] **M0.2** Struktur folder sesuai rancangan (`src/bot`, `src/sticker`, `src/downloader`, `src/core`, `src/utils`).
- [x] **M0.3** `.gitignore`: `node_modules`, `dist`, `.env`, `data/auth`, `data/tmp`, `data/cookies`, `logs`.
- [x] **M0.4** `.env.example` + validasi config dengan zod.
- [x] **M0.5** Logger pino (stdout, tanpa isi pesan user).
- [x] **M0.6** Error taxonomy + handler global + graceful shutdown.
- [x] **M0.7** Koneksi Baileys:
  - [x] auth state persisten di `data/auth`;
  - [x] login QR **dan** pairing code;
  - [x] reconnect exponential backoff;
  - [x] dedupe message ID (LRU 10 menit).
- [x] **M0.8** Router pesan: prioritas foto → command → link → pending/reply.
- [x] **M0.9** Middleware private mode:
  - [x] `ALLOWED_NUMBERS` whitelist;
  - [x] owner commands;
  - [x] abaikan nomor asing tanpa balasan.
- [x] **M0.10** Command `/menu`, `/help`, `/ping`.
- [x] **M0.11** Script `scripts/smoke-native.mjs` untuk gate native module.
- [x] **M0.12a** Commit pertama.
- [ ] **M0.12b** Tes restart session di perangkat.

**Acceptance M0:** bot online, `ping` → `pong`, hanya nomor whitelist yang dilayani, restart tidak perlu scan ulang.

---

## M1 — Stiker dasar dari foto

- [x] **M1.1** Terima gambar dari chat dan reply-to-image; unduh media Baileys.
- [x] **M1.2** Validasi input:
  - [x] tipe JPEG/PNG/WebP;
  - [x] maksimal 10 MB;
  - [x] batas piksel untuk mencegah decompression bomb.
- [x] **M1.3** Pipeline gambar:
  - [x] rotate sesuai EXIF;
  - [x] crop tengah ke 512×512;
  - [x] encode WebP dengan quality loop 82 → 72 → 62 → 52 → 42 → 32 → 24 → 12;
  - [x] berhenti saat ≤100 KB.
- [x] **M1.4** Kirim sticker Baileys + reaksi ⏳/✅.
- [x] **M1.5** Fallback jika masih >100 KB: turunkan quality minimum, lalu blur tipis; log warning.
- [x] **M1.6** Cleanup `data/tmp` setelah kirim; retry untuk file lock Android.
- [ ] **M1.7** Fixture test: portrait, landscape, PNG alpha, JPEG besar, WebP, gambar 12 MP.
- [x] **M1.8** Unit test: dimensi output tepat 512×512, ukuran ≤100 KB, magic bytes WebP.
- [ ] **M1.9** Tes manual di WhatsApp Android; jika ada, tes juga iOS.

**Acceptance M1:** 10 variasi foto menghasilkan stiker valid, tampil benar, dan tidak meninggalkan file temp.

---

## M2 — Teks stiker gaya Indonesia

- [x] **M2.1** Bundle font **Anton** (OFL) di `assets/fonts`; register ke canvas.
- [x] **M2.2** Renderer teks:
  - [x] uppercase;
  - [x] word-wrap maksimal 3 baris;
  - [x] auto font size;
  - [x] putih + outline hitam 8–12 px;
  - [x] shadow tipis;
  - [x] margin 28 px, lebar maksimal 448 px.
- [x] **M2.3** Posisi: `atas`, `bawah` (default), `tengah`.
- [x] **M2.4** Dua zona: `atas: TEKS 1 | bawah: TEKS 2`.
- [x] **M2.5** Parser caption:
  - [x] tanpa prefix → bawah;
  - [x] prefix `atas:` / `bawah:` / `tengah:`;
  - [x] batas 140 karakter.
- [x] **M2.6** State "menunggu teks":
  - [x] foto tanpa caption → bot minta teks;
  - [x] TTL 5 menit;
  - [x] `/skip` → tanpa teks;
  - [x] reply foto + teks → langsung render.
- [ ] **M2.7** Emoji: register Noto Color Emoji jika tersedia; jika tidak, strip emoji + beri info.
- [ ] **M2.8** Golden test layout: teks pendek, panjang, 2 zona, karakter aneh.
- [x] **M2.9** Pastikan hasil akhir tetap ≤100 KB setelah overlay.
- [ ] **M2.10** Tes manual: teks terbaca di background terang/gelap dan tidak terpotong.

**Acceptance M2:** pengguna bisa mengirim foto + teks dan mendapat stiker meme Indonesia yang rapi; semua posisi bekerja.

---

## M3 — Downloader TikTok

- [x] **M3.1** Deteksi URL + allowlist domain (`tiktok.com`, `vm.tiktok.com`, `vt.tiktok.com`).
- [x] **M3.2** Resolve short link dengan validasi domain; blokir IP/localhost/port aneh (SSRF guard).
- [x] **M3.3** Wrapper `yt-dlp`:
  - [x] spawn tanpa shell;
  - [x] timeout 90 detik;
  - [x] batas ukuran dan durasi;
  - [x] path output unik di `data/tmp`.
- [ ] **M3.4** Verifikasi format no-watermark pada 10 link nyata; jika watermark muncul, uji selector alternatif.
- [x] **M3.5** Fallback TikTok: TikWM (bisa dimatikan via env; catat implikasi privasi).
- [x] **M3.6** Kirim video:
  - [x] ≤16 MB → kirim langsung;
  - [x] >16 MB → ffmpeg 720p H.264/AAC;
  - [x] masih >16 MB → 480p;
  - [x] masih >16 MB → dokumen.
- [x] **M3.7** TikTok slideshow: kirim gambar berurutan (maks 10) + audio jika tersedia.
- [ ] **M3.8** Queue: 1 download + 1 transcode bersamaan; serial per user.
- [x] **M3.9** Rate limit: 3 download / 5 menit / user.
- [x] **M3.10** Pesan error Indonesia: link private, dihapus, timeout, terlalu besar.
- [x] **M3.11** Cleanup setelah kirim, termasuk file hasil transcode.

**Acceptance M3:** 10 link TikTok (video, short link, slideshow) berhasil; tidak ada watermark; video playable di WhatsApp.

---

## M4 — Downloader Instagram

- [x] **M4.1** Allowlist `instagram.com`; dukung `/p/`, `/reel/`, `/reels/`, `/tv/`.
- [x] **M4.2** Dukungan cookies Netscape di `data/cookies/instagram.txt`.
- [x] **M4.3** Wrapper yt-dlp dengan `--cookies`; tanpa `--cookies-from-browser` (tidak ada browser di Termux).
- [ ] **M4.4** Fallback `gallery-dl` untuk carousel/foto (opsional, hanya jika diperlukan).
- [x] **M4.5** Output: reel/video, foto tunggal, carousel maksimal 10 media, jeda 1 detik antar-media.
- [ ] **M4.6** Deteksi cookies kedaluwarsa/login wall → pesan jelas ke user + notifikasi owner.
- [x] **M4.7** Rate limit lebih ketat: 2 download / 10 menit / user.
- [x] **M4.8** Dokumentasi cara export cookies dan risiko akun.
- [ ] **M4.9** Tes dengan 5 URL publik dan 5 URL yang butuh cookies.

**Acceptance M4:** Reel, foto, dan carousel berhasil; error cookies/private ditangani tanpa crash.

---

## M5 — Hardening, Termux service, dan operasional

- [x] **M5.1** Rate limiter global + per user; antrean maksimal; tolak dengan pesan "lagi ramai".
- [x] **M5.2** Disk guard: tolak download jika sisa disk <1 GB; cleanup otomatis.
- [ ] **M5.3** Log rotation (runit/svlogd) + level log via env.
- [ ] **M5.4** Health: heartbeat log, `/stats` untuk owner (uptime, queue, disk, sukses/gagal).
- [ ] **M5.5** Notifikasi error kritis ke owner dengan cooldown agar tidak spam.
- [ ] **M5.6** Service runit:
  - [ ] `$PREFIX/var/service/wa-bot/run`;
  - [ ] `sv-enable wa-bot`;
  - [ ] auto-restart on crash.
- [ ] **M5.7** Boot script `~/.termux/boot/start-services` + `termux-wake-lock`.
- [ ] **M5.8** Pastikan Termux:Boot berjalan setelah reboot.
- [ ] **M5.9** Backup `data/auth`:
  - [ ] script tar ke `~/backups`;
  - [ ] jadwal mingguan;
  - [ ] dokumentasi restore.
- [ ] **M5.10** Deploy script: `git pull` → `npm ci` → `npm run build` → `sv restart wa-bot`.
- [ ] **M5.11** Soak test 24 jam: memori, suhu, baterai, reconnect, cleanup.
- [ ] **M5.12** Test jaringan putus/nyambung; test reboot; test session expired.
- [x] **M5.13** README: setup Termux, pairing code, cookies, troubleshooting, limit.
- [ ] **M5.14** Update yt-dlp bulanan + checklist regresi downloader.

**Acceptance M5:** bot bertahan 24 jam, auto-start setelah reboot, tidak ada kebocoran file, dan owner bisa memantau kondisi bot.

---

## M6 — Grup (setelah private stabil)

- [ ] **M6.1** `ALLOWED_GROUPS` whitelist; default kosong.
- [ ] **M6.2** Hanya respons command atau mention.
- [ ] **M6.3** Rate limit per grup + per user.
- [ ] **M6.4** Larangan auto-download link tanpa command di grup.
- [ ] **M6.5** Moderasi sederhana: blokir user/grup, laporan ke owner.

**Acceptance M6:** bot tidak spam di grup dan hanya aktif di grup yang diizinkan.

---

## Termux runbook (ringkas)

```bash
# Paket dasar
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git ffmpeg python termux-services openssh
pip install -U yt-dlp

# Cek arsitektur (harus aarch64)
uname -m

# Wake lock
termux-wake-lock

# Ambil project (pilih salah satu)
git clone <repo-url> ~/bot-wa-1
# atau dari PC: scp -r D:\Project\bot-wa-1 <user>@<ip>:~/  (via ssh Termux)

# Install & build
cd ~/bot-wa-1
npm ci --allow-git=all
npm run build

# Jalankan manual untuk pairing pertama
node dist/index.js
```

**Boot script** `~/.termux/boot/start-services`:

```sh
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
. $PREFIX/etc/profile.d/start-services.sh
```

**Service** `$PREFIX/var/service/wa-bot/run`:

```sh
#!/data/data/com.termux/files/usr/bin/sh
export PATH=/data/data/com.termux/files/usr/bin:$PATH
exec 2>&1
cd $HOME/bot-wa-1
exec node dist/index.js
```

```bash
chmod +x $PREFIX/var/service/wa-bot/run
sv-enable wa-bot
sv up wa-bot
sv status wa-bot
```

Catatan:

- `termux-services` perlu restart Termux sekali setelah instalasi.
- Jangan taruh project di `/sdcard`; gunakan home Termux.
- WhatsApp + Termux di HP yang sama → gunakan **pairing code**, bukan QR.
- HP harus tetap charger dan tidak di-sleep; pantau suhu dan baterai.
- Jangan buka port ke internet; SSH hanya untuk LAN/Tailscale.

---

## Matriks tes per milestone

| Area        | Tes otomatis                 | Tes manual               |
| ----------- | ---------------------------- | ------------------------ |
| Stiker      | dimensi, ukuran, magic bytes | Android + iOS            |
| Teks        | wrap, overflow, 2 zona       | background terang/gelap  |
| TikTok      | mock yt-dlp + parser         | 10 link nyata            |
| Instagram   | mock cookies/error           | 5 link publik + cookies  |
| Koneksi     | mock socket/reconnect        | pairing, restart, reboot |
| Operasional | rate limit, cleanup          | soak 24 jam, suhu        |

---

## Risiko yang dipantau

- [ ] **Doze/OEM killer** mematikan Termux → wake lock, disable battery optimization, cek vendor settings.
- [ ] **Thermal throttling** saat transcode → concurrency 1, hanya transcode jika perlu, batasi durasi.
- [ ] **Baterai kembung** karena charger terus-menerus → pantau suhu; gunakan charge limit bila tersedia.
- [ ] **Baileys ban** → nomor cadangan, private mode, tanpa broadcast, delay kirim.
- [ ] **Cookies IG kedaluwarsa** → deteksi error, notifikasi owner, export ulang.
- [ ] **yt-dlp rusak** karena perubahan TikTok/IG → update bulanan, provider fallback.
- [ ] **Native module update** → pin versi, uji ulang setelah `npm update`.
- [ ] **Session hilang** → backup `data/auth`, dokumentasi pairing ulang.
- [ ] **Hak cipta/ToS** → penggunaan pribadi, tidak menyimpan/mendistribusikan ulang media.

---

## Definition of Done Fase 1

- [ ] Stiker dari foto + teks bekerja untuk semua posisi.
- [ ] TikTok dan Instagram downloader bekerja, dengan fallback dan error yang jelas.
- [ ] Hanya nomor whitelist yang dilayani.
- [ ] Bot auto-start setelah reboot dan reconnect setelah jaringan putus.
- [ ] Soak test 24 jam lulus; suhu, RAM, dan disk terkendali.
- [ ] Tidak ada file temp tersisa; `data/auth` punya backup.
- [ ] README + `.env.example` + runbook Termux lengkap.
- [ ] Tidak ada kredensial/cookies yang ter-commit.

---

## Hal yang perlu dikonfirmasi sebelum M0

- [ ] Arsitektur HP `aarch64` dan versi Android.
- [ ] WhatsApp bot dan Termux berada di HP yang sama? (menentukan pairing code vs QR)
- [ ] Apakah ada repo Git privat (GitHub/GitLab) untuk deploy ke Termux, atau pakai `scp`/Syncthing?
- [ ] Nomor pribadi yang akan di-whitelist (owner) dan nomor teman circle.
- [ ] Apakah HP bisa tetap charger 24/7 dengan ventilasi yang aman?
