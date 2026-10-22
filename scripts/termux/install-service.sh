#!/data/data/com.termux/files/usr/bin/bash
set -eu

APP_DIR="${APP_DIR:-$HOME/bot-wa-1}"
SERVICE_NAME="${SERVICE_NAME:-wa-bot}"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
SERVICE_DIR="$PREFIX/var/service/$SERVICE_NAME"
LOG_DIR="${LOG_DIR:-$HOME/.local/share/wa-bot/log}"
BOOT_DIR="$HOME/.termux/boot"
BOOT_SCRIPT="$BOOT_DIR/start-wa-bot"

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

mkdir -p "$SERVICE_DIR/log" "$LOG_DIR" "$BOOT_DIR"

cat >"$SERVICE_DIR/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
export PATH="$PREFIX/bin:\$PATH"
export NODE_ENV=production
export TZ="${TZ:-Asia/Jakarta}"
cd "$APP_DIR" || exit 1
exec 2>&1
exec node dist/index.js
EOF

cat >"$SERVICE_DIR/log/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
export PATH="$PREFIX/bin:\$PATH"
export TZ="${TZ:-Asia/Jakarta}"
mkdir -p "$LOG_DIR"
exec svlogd -tt "$LOG_DIR"
EOF

cat >"$BOOT_SCRIPT" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
"$PREFIX/bin/termux-wake-lock" 2>/dev/null || true
if [ -r "$PREFIX/etc/profile.d/start-services.sh" ]; then
  . "$PREFIX/etc/profile.d/start-services.sh"
fi
EOF

chmod 755 "$SERVICE_DIR/run" "$SERVICE_DIR/log/run" "$BOOT_SCRIPT"

if [ -f "$APP_DIR/.env" ]; then
  chmod 600 "$APP_DIR/.env"
fi

termux-wake-lock 2>/dev/null || true
sv-enable "$SERVICE_NAME" 2>/dev/null || true

if ! sv up "$SERVICE_NAME"; then
  echo "Service terpasang, tetapi service daemon belum berjalan." >&2
  echo "Tutup lalu buka ulang Termux, kemudian jalankan: sv up $SERVICE_NAME" >&2
  exit 1
fi

echo
echo "Service $SERVICE_NAME dipasang."
echo "Log   : $LOG_DIR/current"
echo "Status: sv status $SERVICE_NAME"
echo "Stop  : sv down $SERVICE_NAME"
echo "Mulai : sv up $SERVICE_NAME"
