# Termux service

Jalankan dari dalam folder project:

```bash
bash scripts/termux/install-service.sh
```

Script ini membuat:

- `$PREFIX/var/service/wa-bot/run`
- `$PREFIX/var/service/wa-bot/log/run`
- `$PREFIX/var/service/wa-bot-updater/run` (auto-update dari GitHub)
- `$PREFIX/var/service/wa-bot-updater/log/run`
- `$PREFIX/etc/wa-bot-updater/updater.sh` (salinan `scripts/termux/updater.sh` saat service start)
- `~/.termux/boot/start-wa-bot`

Lalu mengaktifkan kedua service dan wake lock.

Perintah operasional:

```bash
sv status wa-bot wa-bot-updater
sv down wa-bot wa-bot-updater
sv up wa-bot wa-bot-updater
sv restart wa-bot wa-bot-updater
tail -f ~/.local/share/wa-bot/log/current
tail -f ~/.local/share/wa-bot-updater/log/current
```

Syarat:

- `termux-services` sudah terpasang dan Termux sudah di-restart sekali setelah instalasi.
- `dist/index.js` sudah dibuat dengan `npm run build`.
- `.env` sudah berisi whitelist nomor.
- Termux:Boot sudah dibuka sekali dan optimasi baterai untuk Termux dimatikan.

Jika `sv up` gagal karena service daemon belum berjalan:

```bash
. $PREFIX/etc/profile.d/start-services.sh
sv up wa-bot wa-bot-updater
```

Service hanya menjaga proses tetap hidup; masalah DNS/jaringan tetap harus diselesaikan
di perangkat.

## Auto-update dari GitHub

Service `wa-bot-updater` mem-polling branch utama repo tiap `UPDATE_INTERVAL_SEC`
(default 60 detik). Saat `git fetch` menemukan `origin/<branch>` yang lebih baru dari HEAD:

1. Jika ada perubahan lokal pada file ter-track (`git status --porcelain`), update
   **dilewati** dan ditandai `WARN` di log. Commit, stash, atau revert dulu agar update
   bisa masuk.
2. Jika bersih: `git merge --ff-only origin/<branch>`.
3. Jika `package.json`/`package-lock.json` berubah: `npm ci --allow-git=all`.
4. `npm run build`.
5. `sv restart wa-bot` — hanya dilakukan setelah build sukses; jika build gagal,
   working tree otomatis di-rollback ke commit sebelumnya dan bot tetap berjalan
   dengan kode lama.

Tuning di `install-service.sh` lewat variabel (di-set saat instalasi, atau pakai
variabel lingkungan default di script): `UPDATE_BRANCH` (default `main`),
`UPDATE_INTERVAL_SEC` (default `60`). Terapkan berulang kali:

```bash
UPDATE_INTERVAL_SEC=120 bash scripts/termux/install-service.sh
```

Rollback manual jika commit baru bermasalah:

```bash
cd ~/bot-wa-1
git reset --hard <hash-lama>
npm run build
sv restart wa-bot
```

Repo harus tetap publik atau punya akses fetch; script tidak menyimpan kredensial.
