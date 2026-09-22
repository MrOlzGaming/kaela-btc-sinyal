#!/bin/bash
# run-channel-breakout-vultr.sh (22 Sep 2026) -- runner cadence CEPAT (tiap 1 menit) khusus
# strategi "Channel Breakout" (channelBreakoutTrader.js). TERPISAH TOTAL dari run-vultr-executor.sh
# (15 menit) DAN dari run-position-check-fast.sh (5 menit, Nyopet lama) -- strategi ini punya
# journal SENDIRI (channel-breakout-journal.json), TIDAK nyentuh file/state yang dipakai script
# lain, jadi AMAN pakai LOCK FILE SENDIRI (bukan numpang lock bersama) tanpa risiko korup data
# script lain -- beda dari run-position-check-fast.sh yang WAJIB numpang lock yang sama krn nulis
# journal Nyopet yang SAMA dengan run-vultr-executor.sh.
#
# ⛔ WAJIB `enabled:true` di channel-breakout-config.json dulu (default false) -- Olan yang
# nyalain, JANGAN auto-enable dari sini. testnet default true (demo) sampai Olan eksplisit ubah
# testnet:false DAN allowReal:true bareng.
set -uo pipefail
PROJECT_DIR="/root/kaela-engine"
LOG_FILE="$PROJECT_DIR/channel-breakout.log"
LOCK_FILE="/tmp/kaela-channel-breakout.lock"

cd "$PROJECT_DIR" || exit 1

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Skip -- siklus sebelumnya masih jalan (network lambat?)." >> "$LOG_FILE"
  exit 0
fi

output=$(node channelBreakoutTrader.js 2>&1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] $output" >> "$LOG_FILE"

# Cek rekap saldo-kurang harian TIAP SIKLUS (murah -- cuma baca state lokal, kirim WA 0x atau 1x
# aja per hari begitu tanggalnya kepotong, lihat channelBreakoutBalanceRecap.js).
node -e "require('./channelBreakoutBalanceRecap').reportYesterdayRecapIfPending().then(r=>console.log(JSON.stringify(r)))" >> "$LOG_FILE" 2>&1

# Log cap ~5000 baris (cadence 1 menit = ~1440x/hari, numpuk cepat).
if [ "$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 5000 ]; then
  tail -n 3000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
