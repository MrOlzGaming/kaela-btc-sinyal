#!/bin/bash
# run-econ-calendar-live-vultr.sh (5 Sep 2026) -- detektor kalender ekonomi jendela SEMPIT
# (~5 menit di sekitar waktu event asli), permintaan Olan: "detektor tiap 5 menit.. 5 menit
# sebelum kasih info siap-siap, 5 menit sesudah simpulkan hawkish/dovish + deteksi DXY".
#
# TERPISAH dari run-vultr-executor.sh (siklus trading 15 menit) DAN dari econCalendarMonitor.js
# (peringatan dini 48 JAM, jalan di GitHub Actions tiap 6 jam via econ-calendar.yml, TETAP APA
# ADANYA) -- ini jendela MENIT, jalan SERING (tiap 5 menit) di VPS, BUKAN GitHub Actions (jadwal
# GH Actions bisa telat/gak presisi, gak cukup ketat buat jendela semenit ini).
#
# State dedup (econ-calendar-live-notified.json) MURNI LOKAL buat internal script ini doang, gak
# ditampilin di web publik manapun -- GAK PERLU git commit/push/sync (beda dari sniper-orders.json
# dkk yang dibaca ulang lewat GitHub raw). Script ini juga gak nyentuh file/state lain sama
# sekali (murni HTTP ke ForexFactory/Yahoo Finance/Fonnte) -- AMAN jalan tiap 5 menit tanpa flock,
# sama pola kayak run-manual-open-check-vultr.sh.
set -uo pipefail
PROJECT_DIR="/root/kaela-engine"
LOG_FILE="$PROJECT_DIR/econ-calendar-live.log"

cd "$PROJECT_DIR" || exit 1
output=$(node econCalendarLiveMonitor.js 2>&1)
if ! echo "$output" | grep -q 'gak ada event dalam jendela'; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $output" >> "$LOG_FILE"
fi
