# Termux service

Jalankan dari dalam folder project:

```bash
bash scripts/termux/install-service.sh
```

Script ini membuat:

- `$PREFIX/var/service/wa-bot/run`
- `$PREFIX/var/service/wa-bot/log/run`
- `~/.termux/boot/start-wa-bot`

Lalu mengaktifkan service dan wake lock.

Perintah operasional:

```bash
sv status wa-bot
sv down wa-bot
sv up wa-bot
sv restart wa-bot
tail -f ~/.local/share/wa-bot/log/current
```

Syarat:

- `termux-services` sudah terpasang dan Termux sudah di-restart sekali setelah instalasi.
- `dist/index.js` sudah dibuat dengan `npm run build`.
- `.env` sudah berisi whitelist nomor.
- Termux:Boot sudah dibuka sekali dan optimasi baterai untuk Termux dimatikan.

Jika `sv up` gagal karena service daemon belum berjalan:

```bash
. $PREFIX/etc/profile.d/start-services.sh
sv up wa-bot
```

Service hanya menjaga proses tetap hidup; masalah DNS/jaringan tetap harus diselesaikan
di perangkat.
