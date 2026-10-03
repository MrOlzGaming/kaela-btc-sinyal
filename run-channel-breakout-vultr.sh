#!/bin/bash
# run-channel-breakout-vultr.sh (22 Sep 2026) -- runner cadence CEPAT (tiap 1 menit) khusus
# strategi "Ninja" (dulu "Channel Breakout", ninjaTrader.js). TERPISAH TOTAL dari run-vultr-executor.sh
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

output=$(node ninjaTrader.js 2>&1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] $output" >> "$LOG_FILE"

# NINJA Mean Reversion 15M PAPER (30 Sep 2026, ninjaMrSignal.js) -- sinyal + hitungan kertas buat
# eksekusi manual Olan, TANPA order exchange. Journal sendiri (ninja-mr-journal.json), murah:
# cuma kerja pas ada candle 15M baru closed. Saklar: ninja-mr-config.json enabled.
mr_output=$(timeout -k 5 45 node ninjaMrSignal.js 2>&1)
[ -n "$mr_output" ] && echo "[$(date '+%Y-%m-%d %H:%M:%S')] $mr_output" >> "$LOG_FILE"

# NINJA Mean Reversion EKSEKUTOR BingX demo+real (30 Sep 2026, ninjaMrTrader.js) -- akun BingX SAMA
# ninjaTrader.js (entry CB udah dimatikan, tapi keduanya saling cek floating). Journal sendiri
# (ninja-mr-exec-journal.json). Saklar: ninja-mr-exec-config.json.
mrx_output=$(timeout -k 5 55 node ninjaMrTrader.js 2>&1)
[ -n "$mrx_output" ] && echo "[$(date '+%Y-%m-%d %H:%M:%S')] $mrx_output" >> "$LOG_FILE"
# NINJA EXHAUSTION (3 Okt 2026, ninjaExhaustionTrader.js) -- UJI DEMO 100 transaksi sinyal radar likuidasi sendiri
# (forced-flow kehabisan tenaga -> fade). Akun BingX SAMA, saling skip sama Ninja MR. Saklar: ninja-exhaustion-config.json.
exh_output=$(timeout -k 5 50 node ninjaExhaustionTrader.js 2>&1)
[ -n "$exh_output" ] && echo "[$(date '+%Y-%m-%d %H:%M:%S')] $exh_output" >> "$LOG_FILE"
# Pengawas likuidasi DCA Tangga Leverage di BingX STANDARD FUTURES (1 Okt 2026) -- MURNI BACA, gak pernah
# kirim order; posisi kena likuidasi -> DM WA Olan + saran leverage pengganti (lihat stdFuturesLadderMonitor.js).
std_output=$(timeout -k 5 40 node stdFuturesLadderMonitor.js 2>&1)
[ -n "$std_output" ] && echo "[$(date '+%Y-%m-%d %H:%M:%S')] $std_output" >> "$LOG_FILE"

# Cek rekap saldo-kurang harian TIAP SIKLUS (murah -- cuma baca state lokal, kirim WA 0x atau 1x
# aja per hari begitu tanggalnya kepotong, lihat ninjaBalanceRecap.js).
node -e "require('./ninjaBalanceRecap').reportYesterdayRecapIfPending().then(r=>console.log(JSON.stringify(r)))" >> "$LOG_FILE" 2>&1

# Log cap ~5000 baris (cadence 1 menit = ~1440x/hari, numpuk cepat).
if [ "$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 5000 ]; then
  tail -n 3000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
