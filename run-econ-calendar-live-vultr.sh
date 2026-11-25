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
# ditampilin di web publik manapun -- GAK PERLU git commit/push/sync.
#
# 🐛 FIX 19 Sep 2026 -- klaim LAMA di atas ("script ini juga gak nyentuh file/state lain sama
# sekali") SALAH: `econCalendarLiveMonitor.js` MANGGIL `addEntry('econ-calendar-headsup', ...)`
# (nulis archive.json, file TRACKED git) DAN `recordReaction()` (nulis
# econ-reaction-research-log.json, juga TRACKED). Karena script ini TIDAK PERNAH commit sendiri,
# dan `run-vultr-executor.sh` (cron 15 menit TERPISAH, direktori SAMA) mulai tiap siklusnya dengan
# `git fetch && git reset --hard origin-new/master` SEBELUM commit block-nya sendiri jalan --
# tulisan archive/research-log dari script INI (yang jalan di antara 2 siklus vultr-executor)
# rutin KEHAPUS BALIK sebelum sempat ke-commit siapapun. Ini akar masalah kenapa arsip
# `econ-calendar-headsup`/`econ-calendar-result` di archive.json NOL entri sepanjang sejarah
# fitur ini (5 Sep-19 Sep, lihat BUG_REGISTRY.md BUG-KAELATRADE-0010) -- BUKAN soal data actual
# telat/kosong seperti dicatat di situ. Fix: commit+push SENDIRI di sini, SEGERA setelah nulis,
# biar begitu run-vultr-executor.sh reset --hard di siklus berikutnya, datanya udah aman di
# remote (tinggal di-fetch balik, bukan kehapus).
set -uo pipefail
PROJECT_DIR="/root/kaela-engine"
LOG_FILE="$PROJECT_DIR/econ-calendar-live.log"

cd "$PROJECT_DIR" || exit 1
output=$(node econCalendarLiveMonitor.js 2>&1)
if ! echo "$output" | grep -q 'gak ada event dalam jendela'; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $output" >> "$LOG_FILE"
fi

# (26 Nov 2026) SEMUA git di script ini jalan HANYA sambil pegang /tmp/kaela-executor.lock (file lock yang sama dengan
# run-vultr-executor.sh). Dulu `git status` jalan sebelum lock, dan `git add/commit` tetap jalan walau lock gagal
# diambil -> dua cron jalanin git barengan di repo yang sama (dugaan pemicu index.lock nyangkut 17 Okt & 17 Nov 2026).
# Lock gak kedapet (executor lagi jalan) = gak nyentuh git sama sekali: archive.json + econ-reaction-research-log.json
# ada di STATE_FILES executor -> dijaga dari reset --hard + ke-commit+push ujung siklusnya, atau diambil script ini
# 5 menit lagi. `201>&-` = proses git (termasuk gc latar belakang) gak mewarisi lock.
SYNC_STATUS_LINE=""
CHANGED=""
exec 201>/tmp/kaela-executor.lock
if flock -w 5 201; then
  if [ -f "$PROJECT_DIR/git-lock-guard.sh" ]; then
    . "$PROJECT_DIR/git-lock-guard.sh"
    bersihkan_lock_git_basi "$LOG_FILE" 'econ-calendar-live' 201>&-
  fi
  CHANGED=$(git status --porcelain -- archive.json econ-reaction-research-log.json 201>&-)
fi
if [ -n "$CHANGED" ]; then
  for f in archive.json econ-reaction-research-log.json; do
    [ -f "$f" ] && git add "$f" 201>&-
  done
  git commit -m "Auto: sync econ-calendar-live $(date '+%Y-%m-%d %H:%M')" --quiet >> "$LOG_FILE" 2>&1 201>&-
  synced=0
  for attempt in 1 2 3; do
    [ "$synced" -eq 1 ] && break
    if timeout -k 10 20 git pull --rebase --autostash origin-new master --quiet >> "$LOG_FILE" 2>&1 201>&- \
       && timeout -k 10 20 git push origin-new master --quiet >> "$LOG_FILE" 2>&1 201>&-; then
      synced=1
      break
    fi
    git rebase --abort >/dev/null 2>&1 201>&- || true # (4 Okt 2026) konflik -> jangan tinggalin repo setengah rebase (HEAD detached)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] econ-calendar-live: sync GAGAL percobaan $attempt, coba lagi..." >> "$LOG_FILE"
    sleep 3
  done
  if [ "$synced" -eq 1 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] econ-calendar-live: archive/research-log ke-sync." >> "$LOG_FILE"
  else
    SYNC_STATUS_LINE="econ-calendar-live: sync GAGAL 3x -- entri BERISIKO kehapus git reset --hard siklus vultr-executor berikutnya."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $SYNC_STATUS_LINE" >> "$LOG_FILE"
  fi
fi
exec 201>&- # lepas lock secepatnya, sebelum lapor

# 🐛 FIX 19 Sep 2026 (audit -- "siapa mengawasi run-econ-calendar-live-vultr.sh sendiri?") --
# SEBELUM ini, error/exception di script ini (`node econCalendarLiveMonitor.js` gagal, atau sync
# git gagal 3x di atas) cuma ditulis ke log lokal (`econ-calendar-live.log`) -- gak ada jalur ke
# WA/GAS kayak `run-vultr-executor.sh`/`dark-kaela-monitor.yml` yang SAMA-SAMA punya
# `reportCycleErrors.js` di ujung siklusnya. Kalau ForexFactory/Yahoo Finance berubah format dan
# script ini error terus-menerus berhari-hari, gak ada yang bakal tahu kecuali baca log manual di
# VPS. Fix: scan output NODE + status sync SIKLUS INI SAJA (variabel lokal, bukan baca ulang file
# log), lapor ke Watchdog GAS (dedup+cooldown di sisi GAS, sama mekanisme run-vultr-executor.sh --
# aman dipanggil tiap 5 menit, gak akan spam).
CYCLE_ERRORS=$(printf '%s\n%s\n' "$output" "${SYNC_STATUS_LINE:-}" | grep -iE 'error|gagal' | sort -u | head -20 || true)
if [ -n "$CYCLE_ERRORS" ]; then
  node reportCycleErrors.js 'econ-calendar-live' "$CYCLE_ERRORS" >> "$LOG_FILE" 2>&1 || true
fi
