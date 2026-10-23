#!/data/data/com.termux/files/usr/bin/bash
# Auto-update: polling GitHub, pull, build, lalu restart service wa-bot.
# Dijalankan sebagai service runit "wa-bot-updater" (lihat install-service.sh).
set -u

APP_DIR="${APP_DIR:-$HOME/bot-wa-1}"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"

BRANCH="${UPDATE_BRANCH:-main}"
INTERVAL="${UPDATE_INTERVAL_SEC:-60}"
RESTART_DELAY="${RESTART_DELAY_SEC:-5}"

cd "$APP_DIR" 2>/dev/null || exit 1

log() {
  printf '%s updater: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1"
}

if ! command -v git >/dev/null 2>&1; then
  log "ERROR git tidak ditemukan. Jalankan: pkg install -y git"
  sleep 300
  exit 1
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  log "ERROR $APP_DIR bukan repo git."
  sleep 300
  exit 1
fi

while true; do
  sleep "$INTERVAL"

  if ! git fetch --quiet origin "$BRANCH" 2>/dev/null; then
    log "WARN fetch origin/$BRANCH gagal; coba lagi di interval berikutnya."
    continue
  fi

  local_head="$(git rev-parse HEAD 2>/dev/null || true)"
  remote_head="$(git rev-parse "origin/$BRANCH" 2>/dev/null || true)"

  if [ -z "$local_head" ] || [ -z "$remote_head" ]; then
    log "WARN branch $BRANCH tidak ditemukan di origin; cek remote."
    continue
  fi

  [ "$local_head" = "$remote_head" ] && continue

  log "Commit baru: $(git log -1 --format='%h %s' "origin/$BRANCH" 2>/dev/null || echo "$remote_head")"

  dirty="$(git status --porcelain --untracked-files=no 2>/dev/null || echo '?')"
  if [ -n "$dirty" ]; then
    log "WARN ada perubahan lokal pada file ter-track; update dilewati. Commit, stash, atau revert dulu."
    continue
  fi

  old_head="$local_head"
  rollback() {
    if ! git reset --hard "$old_head" >/dev/null 2>&1; then
      log "ERROR rollback ke $old_head gagal; jalankan manual: git reset --hard $old_head"
      return
    fi
    npm run build --silent >/dev/null 2>&1 \
      || log "WARN rollback build gagal; jalankan manual: npm run build"
    log "Kembali ke commit $(git rev-parse --short HEAD 2>/dev/null || echo "$old_head")."
  }

  if ! git merge --ff-only "origin/$BRANCH" >/dev/null 2>&1; then
    log "WARN fast-forward gagal (riwayat tidak linear?); update dilewati."
    continue
  fi

  if git diff --name-only "$old_head" "$remote_head" 2>/dev/null | grep -e 'package\.json$' -e 'package-lock\.json$' >/dev/null; then
    log "Dependencies berubah; menjalankan npm ci --allow-git=all..."
    if ! npm ci --allow-git=all --no-audit --no-fund; then
      log "WARN npm ci gagal; service tidak direstart. Rollback kini."
      rollback
      continue
    fi
  fi

  log "Menjalankan npm run build..."
  if ! npm run build >/dev/null 2>&1; then
    log "WARN build gagal; service tidak direstart. Rollback kini."
    rollback
    continue
  fi

  log "Build sukses; restart wa-bot..."
  if ! sv restart wa-bot; then
    log "WARN sv restart wa-bot gagal; jalankan manual: sv restart wa-bot"
    sleep "$RESTART_DELAY"
    continue
  fi

  sleep "$RESTART_DELAY"
  log "Selesai: $BRANCH tetap di $(git rev-parse --short HEAD 2>/dev/null || echo "$remote_head")."
done
