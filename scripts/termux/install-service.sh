#!/data/data/com.termux/files/usr/bin/bash
set -eu

APP_DIR="${APP_DIR:-$HOME/bot-wa-1}"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
BOT_SERVICE="${BOT_SERVICE:-wa-bot}"
UPDATER_SERVICE="${UPDATER_SERVICE:-wa-bot-updater}"
BOT_SERVICE_DIR="$PREFIX/var/service/$BOT_SERVICE"
UPDATER_SERVICE_DIR="$PREFIX/var/service/$UPDATER_SERVICE"
LOG_DIR="${LOG_DIR:-$HOME/.local/share/wa-bot/log}"
UPDATER_LOG_DIR="${UPDATER_LOG_DIR:-$HOME/.local/share/wa-bot-updater/log}"
BOOT_DIR="$HOME/.termux/boot"
BOOT_SCRIPT="$BOOT_DIR/start-wa-bot"
TZ_VALUE="${TZ:-Asia/Jakarta}"
INTERVAL="${UPDATE_INTERVAL_SEC:-60}"
BRANCH="${UPDATE_BRANCH:-main}"

if [ "$(uname -m)" != "aarch64" ]; then
  echo "Peringatan: arsitektur $(uname -m), seharusnya aarch64." >&2
fi

if [ ! -f "$APP_DIR/dist/index.js" ]; then
  echo "dist/index.js tidak ditemukan. Jalankan: cd $APP_DIR && npm run build" >&2
  exit 1
fi

if [ ! -f "$APP_DIR/.env" ]; then
  echo "Peringatan: $APP_DIR/.env belum ada; bot akan gagal start." >&2
fi

if ! command -v sv >/dev/null 2>&1; then
  echo "termux-services belum terpasang. Jalankan: pkg install -y termux-services" >&2
  exit 1
fi

mkdir -p "$BOT_SERVICE_DIR/log" "$LOG_DIR" "$UPDATER_SERVICE_DIR/log" "$UPDATER_LOG_DIR" "$BOOT_DIR"

cat >"$BOT_SERVICE_DIR/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
export PATH="$PREFIX/bin:\$PATH"
export NODE_ENV=production
export TZ="$TZ_VALUE"
cd "$APP_DIR" || exit 1
exec 2>&1
exec node dist/index.js
EOF

cat >"$BOT_SERVICE_DIR/log/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
export PATH="$PREFIX/bin:\$PATH"
export TZ="$TZ_VALUE"
mkdir -p "$LOG_DIR"
exec svlogd -tt "$LOG_DIR"
EOF

cat >"$UPDATER_SERVICE_DIR/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
export PATH="$PREFIX/bin:\$PATH"
export TZ="$TZ_VALUE"
export APP_DIR="$APP_DIR"
export UPDATE_BRANCH="$BRANCH"
export UPDATE_INTERVAL_SEC="$INTERVAL"
# Salin dulu ke jalur statis supaya git checkout di tengah proses tidak
# mengubah file yang sedang dieksekusi bash.
mkdir -p "$PREFIX/etc/wa-bot-updater"
cp "$APP_DIR/scripts/termux/updater.sh" "$PREFIX/etc/wa-bot-updater/updater.sh"
exec bash "$PREFIX/etc/wa-bot-updater/updater.sh"
EOF

cat >"$UPDATER_SERVICE_DIR/log/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
export PATH="$PREFIX/bin:\$PATH"
export TZ="$TZ_VALUE"
mkdir -p "$UPDATER_LOG_DIR"
exec svlogd -tt "$UPDATER_LOG_DIR"
EOF

cat >"$BOOT_SCRIPT" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
"$PREFIX/bin/termux-wake-lock" 2>/dev/null || true
if [ -r "$PREFIX/etc/profile.d/start-services.sh" ]; then
  . "$PREFIX/etc/profile.d/start-services.sh"
fi
EOF

chmod 755 \
  "$BOT_SERVICE_DIR/run" \
  "$BOT_SERVICE_DIR/log/run" \
  "$UPDATER_SERVICE_DIR/run" \
  "$UPDATER_SERVICE_DIR/log/run" \
  "$BOOT_SCRIPT"

if [ -f "$APP_DIR/.env" ]; then
  chmod 600 "$APP_DIR/.env"
fi

termux-wake-lock 2>/dev/null || true
sv-enable "$BOT_SERVICE" 2>/dev/null || true
sv-enable "$UPDATER_SERVICE" 2>/dev/null || true

if ! sv up "$BOT_SERVICE" "$UPDATER_SERVICE"; then
  echo "Service terpasang, tetapi service daemon belum berjalan." >&2
  echo "Tutup lalu buka ulang Termux, kemudian jalankan: sv up $BOT_SERVICE $UPDATER_SERVICE" >&2
  exit 1
fi

echo
echo "Service $BOT_SERVICE dan $UPDATER_SERVICE dipasang."
echo "Log bot   : $LOG_DIR/current"
echo "Log update: $UPDATER_LOG_DIR/current"
echo "Status    : sv status $BOT_SERVICE $UPDATER_SERVICE"
echo "Stop      : sv down $BOT_SERVICE $UPDATER_SERVICE"
echo "Mulai     : sv up $BOT_SERVICE $UPDATER_SERVICE"
