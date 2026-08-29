#!/bin/bash
# run-vultr-executor.sh -- port dari run-local-executor.ps1 (PC rumah Olan, PowerShell/Task
# Scheduler) ke Linux/cron buat Vultr (29 Agu 2026, migrasi eksekutor ke server IP statis).
# Logic SAMA PERSIS: git sync -> checkLeader (klaim atomik, N mesin boleh nyala bareng, cuma 1
# yang eksekusi tiap siklus) -> eksekusi -> commit+push state kalau berubah -> purge CDN.
# flock cegah overlap kalau 1 siklus lebih lama dari interval cron (15 menit).
#
# FIX KRITIS 29 Agu 2026 (bug NYATA -- box ini macet 6+ jam, 26+ siklus gagal berturut-turut):
# `git pull` POLOS bisa gagal total ("Need to specify how to reconcile divergent branches")
# kalau history lokal SEMPAT diverge dari origin (misal box ini sempat commit sendiri di window
# yang sama kayak mesin lain -- checkLeader cegah DOBEL EKSEKUSI, tapi gak nyegah 2 mesin
# nge-commit state file di detik yang beda tapi masih dalam window yang sama, itu bikin history
# beneran cabang). Box ini SEHARUSNYA murni FOLLOWER origin (gak ada history lokal yang perlu
# dijaga) -- fetch+reset --hard AMAN dan BENAR di sini, beda dari repo development biasa.
set -uo pipefail
PROJECT_DIR="/root/kaela-engine"
LOG_FILE="$PROJECT_DIR/local-executor.log"
LOCK_FILE="/tmp/kaela-executor.lock"

exec 200>"$LOCK_FILE"
flock -n 200 || exit 0

cd "$PROJECT_DIR" || exit 1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"; }

log '--- Run mulai ---'

if ! timeout 30 git fetch origin-new master --quiet >> "$LOG_FILE" 2>&1; then
  log 'git fetch GAGAL/timeout -- coba lagi run berikutnya.'
  exit 1
fi
if ! git reset --hard origin-new/master --quiet >> "$LOG_FILE" 2>&1; then
  log 'git reset --hard GAGAL -- coba lagi run berikutnya.'
  exit 1
fi
log 'git sync sukses (fetch+reset --hard).'

leader_tmp=$(mktemp)
node checkLeader.js > "$leader_tmp" 2>&1
leader_exit=$?
cat "$leader_tmp" >> "$LOG_FILE"
rm -f "$leader_tmp"
if [ $leader_exit -ne 0 ]; then
  log '--- Standby siklus ini (bukan leader), run selesai tanpa eksekusi ---'
  exit 0
fi

node localLiveExecutor.js >> "$LOG_FILE" 2>&1 || log "localLiveExecutor.js ERROR (exit $?)"

# Pantau leg2/partial-exit posisi Sniper yang UDAH live -- localLiveExecutor.js cuma nanganin ENTRY.
node sniperLiveMonitor.js >> "$LOG_FILE" 2>&1 || log "sniperLiveMonitor.js ERROR (exit $?)"

# Nyopet Auto-Trader -- ping-pong zona likuiditas, numpang cadence yang sama.
node nyopetAutoTrader.js >> "$LOG_FILE" 2>&1 || log "nyopetAutoTrader.js ERROR (exit $?)"

# Kaela Pro Trader -- eksekutor MULTI-AKUN, JALAN TERAKHIR (butuh sniper-orders.json fresh).
node multiAccountExecutor.js >> "$LOG_FILE" 2>&1 || log "multiAccountExecutor.js ERROR (exit $?)"

# Compound Alt DCA + Musiman -- eksekusi live (29 Agu 2026, ditambahin sekalian pas box ini
# diperbaiki -- run-local-executor.ps1 (PC rumah) udah punya ini dari sebelumnya).
node spotAltLiveExecutor.js >> "$LOG_FILE" 2>&1 || log "spotAltLiveExecutor.js ERROR (exit $?)"

CHANGED=$(git status --porcelain -- sniper-orders.json kaela-bankroll.json nyopet-journal.json kaela-spot-alt.json kaela-spot.json)
if [ -n "$CHANGED" ]; then
  log 'Ada perubahan state -- push balik ke GitHub...'
  # Per-file safe (29 Agu 2026) -- `git add fileA fileB` CRASH TOTAL kalau salah satu gak ada
  # (kaela-spot-alt.json/kaela-spot.json belum tentu ada sampai buy pertama, 19 Okt 2026+).
  for f in sniper-orders.json kaela-bankroll.json nyopet-journal.json kaela-spot-alt.json kaela-spot.json; do
    [ -f "$f" ] && git add "$f"
  done
  git commit -m "Auto: sync eksekusi live (Vultr run-executor) $(date '+%Y-%m-%d %H:%M')" --quiet >> "$LOG_FILE" 2>&1
  if timeout 30 git push origin-new master --quiet >> "$LOG_FILE" 2>&1; then
    log 'Push selesai.'
    for f in sniper-orders.json kaela-bankroll.json nyopet-journal.json kaela-spot-alt.json kaela-spot.json; do
      curl -s -o /dev/null "https://purge.jsdelivr.net/gh/MrOlzGaming/kaela-btc-sinyal@master/$f" || true
    done
    log 'Purge jsDelivr selesai.'
  else
    log 'Push GAGAL/timeout (state ke-commit lokal, dicoba lagi siklus berikutnya).'
  fi
else
  log 'Gak ada perubahan state, gak perlu push.'
fi

log '--- Run selesai ---'
