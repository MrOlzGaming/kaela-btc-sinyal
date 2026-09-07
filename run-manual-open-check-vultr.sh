#!/bin/bash
# run-manual-open-check-vultr.sh (3 Sep 2026) -- versi Linux/cron dari run-force-sync-check.ps1
# (PC rumah Olan, PowerShell/Task Scheduler), KHUSUS checkManualOpenRequest.js. Jadwal CEPAT
# (~1 menit, TERPISAH dari run-vultr-executor.sh yang 15 menit) -- Olan: "buka posisi manual dari
# web, gak usah nunggu 15 menit". Script ini TIDAK nyentuh file lokal/git sama sekali (cuma HTTP ke
# GAS/Binance/MEXC), jadi AMAN jalan tiap menit tanpa flock/git-sync kayak run-vultr-executor.sh.
#
# CATATAN PENTING: Vultr sekarang LEADER utama (2 Sep 2026, IP statis) -- checkManualOpenRequest.js
# gak ngecek leader sama sekali (GAS getPendingManualOpenRequests pakai LockService buat claim
# atomik, lihat Sheet.gs), jadi AMAN dijalanin di >1 mesin (komputer rumah + Vultr) bersamaan --
# TIDAK ADA risiko dobel-eksekusi biarpun dua-duanya jalan tiap menit.
#
# 8 Sep 2026, permintaan Olan ("executor di komputer ini sangat mengganggu.. cukup di vultr aja,
# kena "makan layar" pas lagi ada kegiatan") -- checkForceSyncRequest.js DITAMBAH ke sini (dari
# run-force-sync-check.ps1 yang DIMATIIN di PC rumah, lihat Task Scheduler), biar tombol "Minta
# Sinkron Sekarang" di Kaela Access TETAP kepantau cepat walau PC rumah nganggur total. Sama-sama
# murah/gak nyentuh git kayak checkManualOpenRequest.js, aman numpang jadwal sama.
set -uo pipefail
PROJECT_DIR="/root/kaela-engine"
LOG_FILE="$PROJECT_DIR/manual-open-check.log"

cd "$PROJECT_DIR" || exit 1
output=$(node checkManualOpenRequest.js 2>&1)
if ! echo "$output" | grep -q 'Gak ada permintaan'; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $output" >> "$LOG_FILE"
fi

output2=$(node checkForceSyncRequest.js 2>&1)
if ! echo "$output2" | grep -q 'Gak ada permintaan'; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $output2" >> "$LOG_FILE"
fi
