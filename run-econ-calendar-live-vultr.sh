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

CHANGED=$(git status --porcelain -- archive.json econ-reaction-research-log.json)
if [ -n "$CHANGED" ]; then
  for f in archive.json econ-reaction-research-log.json; do
    [ -f "$f" ] && git add "$f"
  done
  git commit -m "Auto: sync econ-calendar-live $(date '+%Y-%m-%d %H:%M')" --quiet >> "$LOG_FILE" 2>&1
  synced=0
  for attempt in 1 2 3; do
    if timeout -k 10 20 git pull --rebase origin-new master --quiet >> "$LOG_FILE" 2>&1 \
       && timeout -k 10 20 git push origin-new master --quiet >> "$LOG_FILE" 2>&1; then
      synced=1
      break
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] econ-calendar-live: sync GAGAL percobaan $attempt, coba lagi..." >> "$LOG_FILE"
    sleep 3
  done
  if [ "$synced" -eq 1 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] econ-calendar-live: archive/research-log ke-sync." >> "$LOG_FILE"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] econ-calendar-live: sync GAGAL 3x -- entri BERISIKO kehapus git reset --hard siklus vultr-executor berikutnya." >> "$LOG_FILE"
  fi
fi
