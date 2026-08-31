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
#
# FIX KRITIS #2 30 Agu 2026 (Olan: "keseringan tidur diam-diam, eror diam-diam" -- box ini macet
# TOTAL ~14 jam, puluhan siklus cron nembak tapi NOL baris log ketulis, ketauan gak sengaja pas
# dicek manual). Root cause: `timeout 30 git fetch/push` cuma ngirim sinyal ke proses `git`
# LANGSUNG -- tapi git-over-HTTPS motorin transportnya lewat proses ANAK `git-remote-https` yang
# kadang macet total di level TCP/network TANPA timeout internal sendiri. Proses anak itu WARIS fd
# lock (200) dari shell ini, jadi kalau dia gak ikut mati pas induknya di-timeout, lock TETAP
# kepegang SELAMANYA -- semua siklus cron berikutnya kena `flock -n 200 || exit 0` DIAM-DIAM,
# gak sempat nulis 1 baris log pun (log() baru dipanggil SETELAH baris flock). Fix 2 lapis:
# (1) git http.lowSpeedLimit/Time -- bikin git SENDIRI yang nyerah kalau koneksi macet >20 detik,
#     jadi gak pernah nyampe hang selamanya di awal (ini fix UTAMA, bukan cuma nambah timeout luar).
# (2) HEARTBEAT_FILE ditulis SEBELUM nyoba flock -- jadi walau lock lagi kepegang/macet, tetep ada
#     bukti "cron beneran nembak jam segini" -- gak ada lagi 14 jam kosong tanpa jejak sama sekali.
set -uo pipefail
PROJECT_DIR="/root/kaela-engine"
LOG_FILE="$PROJECT_DIR/local-executor.log"
LOCK_FILE="/tmp/kaela-executor.lock"
HEARTBEAT_FILE="$PROJECT_DIR/cron-heartbeat.log"

# Selalu ketulis, TIDAK PEDULI lock/apapun di bawah berhasil atau nggak -- ini "bukti hidup" cron
# yang paling dasar. Dipangkas biar gak numpuk selamanya (simpan 500 baris terakhir doang).
echo "[$(date '+%Y-%m-%d %H:%M:%S')] cron nembak" >> "$HEARTBEAT_FILE"
tail -n 500 "$HEARTBEAT_FILE" > "$HEARTBEAT_FILE.tmp" 2>/dev/null && mv "$HEARTBEAT_FILE.tmp" "$HEARTBEAT_FILE"

# Idempoten, murah dijalanin tiap siklus -- jamin git PUNYA sendiri nyerah duluan sebelum sempat
# hang selamanya, gak nunggu ketolong `timeout` luar (yang kebukti gak cukup, lihat catatan di atas).
git config --global http.lowSpeedLimit 1000
git config --global http.lowSpeedTime 20

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Lock lagi kepegang (mungkin run sebelumnya masih jalan/macet) -- skip siklus ini." >> "$LOG_FILE"
  exit 0
fi

cd "$PROJECT_DIR" || exit 1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"; }

log '--- Run mulai ---'

# Titik acu buat nangkep "baris log siklus INI SAJA" nanti (30 Agu 2026, "japri aku kalo ada
# error diam-diam") -- dedup+cooldown per baris beneran ada di GAS, lihat reportCycleErrors.js.
CYCLE_LOG_START=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)

# Baris pendek buat dilaporin kalau exit dini di bawah -- CYCLE_ERRORS full (tail+grep) gak
# kepake di jalur ini karena scriptnya keburu exit sebelum nyampe blok laporan di akhir file.
report_and_exit() { node reportCycleErrors.js 'vultr-sg' "$1" >> "$LOG_FILE" 2>&1 || true; exit "$2"; }

if ! timeout -k 10 30 git fetch origin-new master --quiet >> "$LOG_FILE" 2>&1; then
  log 'git fetch GAGAL/timeout -- coba lagi run berikutnya.'
  report_and_exit 'git fetch GAGAL/timeout di vultr-sg' 1
fi
if ! git reset --hard origin-new/master --quiet >> "$LOG_FILE" 2>&1; then
  log 'git reset --hard GAGAL -- coba lagi run berikutnya.'
  report_and_exit 'git reset --hard GAGAL di vultr-sg' 1
fi
log 'git sync sukses (fetch+reset --hard).'

# Cek mandiri kredensial (31 Agu 2026) -- jalan SELALU (bukan cuma pas leader), pola sama kayak
# run-local-executor.ps1. Ini persis kelas bug yang ketemu hari ini (MEXC kosong di mesin ini).
node checkRequiredCredentials.js >> "$LOG_FILE" 2>&1

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

# Relay temuan Kaela researcher (cloud) ke WA Olan (31 Agu 2026) -- sama pola kayak
# run-local-executor.ps1, state di research-log-state.json (shared git, gak dobel kirim antar mesin).
node reportResearchFindings.js >> "$LOG_FILE" 2>&1 || log "reportResearchFindings.js ERROR (exit $?)"

# Cadangan kirim berita pagi/siang/sore (31 Agu 2026) -- GitHub Actions kadang telat/skip jadwal
# berita gara-gara antrian cron akun ini padat (bukan bug kita). runDueNews.js dedup sendiri lewat
# newsMonitor.js (aman dipanggil berkali-kali, no-op kalau slot itu udah kekirim hari ini).
node runDueNews.js >> "$LOG_FILE" 2>&1 || log "runDueNews.js ERROR (exit $?)"

# Audit jadwal GitHub Actions (31 Agu 2026, permintaan Olan: "harus ada Kaela yang otomatis audit
# jalur yang sering ngadat") -- baris "GAGAL: ..." yang dicetaknya ke-scan otomatis di bagian
# laporan error di bawah, relay ke WA Olan lewat jalur yang sama kayak error lain.
node auditGithubActions.js >> "$LOG_FILE" 2>&1 || log "auditGithubActions.js ERROR (exit $?)"

# Cadangan Price Alert + DXY Zone Monitor (31 Agu 2026) -- ketauan dari audit di atas, jadwal GH
# Actions-nya (tiap 5 menit / tiap jam) sering telat berjam-jam gara-gara antrian akun ini padat.
# Kedua script UDAH punya cooldown/state deteksi-transisi sendiri (price-alert-state.json,
# dxy-zone-state.json) -- aman dipanggil tiap siklus 15 menit, gak akan spam WA dobel.
node priceAlertMonitor.js >> "$LOG_FILE" 2>&1 || log "priceAlertMonitor.js ERROR (exit $?)"
node dxyZoneMonitor.js >> "$LOG_FILE" 2>&1 || log "dxyZoneMonitor.js ERROR (exit $?)"

CHANGED=$(git status --porcelain -- sniper-orders.json kaela-bankroll.json nyopet-journal.json kaela-spot-alt.json kaela-spot.json research-log-state.json archive.json price-alert-state.json dxy-zone-state.json)
if [ -n "$CHANGED" ]; then
  log 'Ada perubahan state -- push balik ke GitHub...'
  # Per-file safe (29 Agu 2026) -- `git add fileA fileB` CRASH TOTAL kalau salah satu gak ada
  # (kaela-spot-alt.json/kaela-spot.json belum tentu ada sampai buy pertama, 19 Okt 2026+).
  # archive.json + price-alert-state.json + dxy-zone-state.json ditambahin 31 Agu 2026 (cadangan
  # lokal berita/price alert/DXY) -- WAJIB ikut ke-commit, kalau nggak `git reset --hard` box ini
  # bakal nelen balik dedup state -> alert bisa kekirim dobel.
  for f in sniper-orders.json kaela-bankroll.json nyopet-journal.json kaela-spot-alt.json kaela-spot.json research-log-state.json archive.json price-alert-state.json dxy-zone-state.json; do
    [ -f "$f" ] && git add "$f"
  done
  git commit -m "Auto: sync eksekusi live (Vultr run-executor) $(date '+%Y-%m-%d %H:%M')" --quiet >> "$LOG_FILE" 2>&1
  if timeout -k 10 30 git push origin-new master --quiet >> "$LOG_FILE" 2>&1; then
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

# Ambil baris ERROR/GAGAL siklus INI SAJA (bukan seluruh history log) -- lapor ke GAS, yang
# putusin mana yang BARU (langsung WA Olan) vs yang UDAH pernah dilaporin baru2 ini (didiemin,
# cooldown 60 menit -- lihat Watchdog.gs). Gagal lapor BUKAN alasan gagalin siklus (reportCycleErrors.js
# udah try/catch sendiri + exit 0 selalu, tapi tetep dibungkus true di sini buat jaga-jaga).
CYCLE_ERRORS=$(tail -n +"$((CYCLE_LOG_START + 1))" "$LOG_FILE" | grep -iE 'error|gagal' | sort -u | head -20 || true)
if [ -n "$CYCLE_ERRORS" ]; then
  node reportCycleErrors.js 'vultr-sg' "$CYCLE_ERRORS" >> "$LOG_FILE" 2>&1 || true
fi

log '--- Run selesai ---'
