#!/bin/bash
# run-position-check-fast.sh (13 Sep 2026, permintaan Olan: "tambah posisi reconciler buat jadi
# per 5 menit") -- jalanin positionCheckFast.js (Nyopet+reconciler akun REAL Olan doang) tiap 5
# menit, TERPISAH dari run-vultr-executor.sh (15 menit, semua member+whale+econ+news).
#
# WAJIB pakai LOCK_FILE yang SAMA PERSIS kayak run-vultr-executor.sh (bukan lock baru) -- 2 script
# ini nulis file state YANG SAMA (nyopet-journal akun Olan-real, wibowo-reconciler-state.json).
# Kalau kebetulan overlap waktu (siklus 15 menit lagi jalan pas 5 menit ini nembak), `flock -n`
# non-blocking bikin script ini SKIP diam-diam siklus ini (coba lagi 5 menit berikutnya) --
# BUKAN nunggu/nge-block, dan BUKAN nulis bareng yang bisa korup file JSON.
set -uo pipefail
PROJECT_DIR="/root/kaela-engine"
LOG_FILE="$PROJECT_DIR/position-check-fast.log"
LOCK_FILE="/tmp/kaela-executor.lock"

cd "$PROJECT_DIR" || exit 1

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Skip -- siklus 15 menit lagi pegang lock." >> "$LOG_FILE"
  exit 0
fi

output=$(node positionCheckFast.js 2>&1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')]" >> "$LOG_FILE"
echo "$output" >> "$LOG_FILE"

# Log ini murni operasional (bukan state/git) -- pangkas kasar biar gak numpuk tak terbatas
# (5 menit sekali = ~288x/hari, jauh lebih sering dari log lain). Cap ~5000 baris terakhir.
if [ "$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 5000 ]; then
  tail -n 3000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
