# Wrapper buat Windows Task Scheduler (23 Agu 2026) -- gantiin rencana sewa VPS. Idenya Olan:
# "kalo sinyal datang duluan dan komputer offline (listrik/jaringan mati), begitu komputer
# nyambung lagi sistem otomatis cek & sinkronkan" -- itu PERSIS yang script ini + localLiveExecutor.js
# (field liveExecutedAt = penanda idempotent, aman dijalanin berkali-kali) implementasikan:
# 1. Tarik sinyal terbaru dari GitHub (dideteksi terus-menerus di cloud, gak peduli komputer ini nyala/mati)
# 2. Jalanin localLiveExecutor.js -- otomatis skip yang udah dieksekusi, skip yang kadaluarsa (>48 jam),
#    eksekusi yang masih pending & masih relevan
# 3. Simpen hasilnya balik ke GitHub biar status gak ilang walau komputer mati lagi abis ini
#
# Task Scheduler dijadwalin ulang tiap 15 menit + trigger logon/startup + "run as soon as possible
# after a missed start" -- itu yang bikin "auto nyambung begitu online lagi" beneran kejadian tanpa
# perlu server nyala 24/7.

# $PSScriptRoot (BUKAN hardcode path) -- karakter khusus "★" di nama folder project kena korup
# kalau ditulis literal di file .ps1 tanpa BOM (PowerShell 5.1 baca script pakai ANSI codepage
# default, bukan UTF-8, ketauan 23 Agu 2026 pas run pertama gagal "path does not exist").
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$logFile = Join-Path $projectDir 'local-executor.log'

function Log($msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

Set-Location $projectDir
Log '--- Run mulai ---'

try {
  git pull origin-new master --quiet 2>&1 | Out-Null
  Log 'git pull sukses.'
} catch {
  Log "git pull GAGAL (kemungkinan belum ada internet) -- coba lagi run berikutnya: $($_.Exception.Message)"
  exit 1
}

# Cek giliran (25 Agu 2026, "2 komputer saling backup") -- cuma 1 mesin yang boleh eksekusi order
# real tiap siklus, biar gak dobel-eksekusi (lihat heartbeatCoordinator.js). Exit 0 = leader
# (lanjut), exit 1 = standby (skip eksekusi, cuma lapor hidup -- BUKAN error, jangan alarm).
$leaderOutput = node checkLeader.js 2>&1 | Out-String
Add-Content -Path $logFile -Value $leaderOutput -Encoding utf8
if ($LASTEXITCODE -ne 0) {
  Log '--- Standby siklus ini (bukan leader), run selesai tanpa eksekusi ---'
  exit 0
}

try {
  $output = node localLiveExecutor.js 2>&1 | Out-String
  Add-Content -Path $logFile -Value $output -Encoding utf8
} catch {
  Log "localLiveExecutor.js ERROR: $($_.Exception.Message)"
}

# Pantau leg2/partial-exit posisi Sniper yang UDAH live (23 Agu 2026) -- localLiveExecutor.js
# cuma nanganin ENTRY, ini yang nanganin partial-TP->reopen-breakeven + trailing SMA10.
try {
  $output3 = node sniperLiveMonitor.js 2>&1 | Out-String
  Add-Content -Path $logFile -Value $output3 -Encoding utf8
} catch {
  Log "sniperLiveMonitor.js ERROR: $($_.Exception.Message)"
}

# Nyopet Auto-Trader (23 Agu 2026) -- ping-pong zona likuiditas, numpang cadence yang sama (BTCUSDC
# beda wallet dari Sniper BTCUSDT jadi aman jalan bareng, gak rebutan margin).
try {
  $output2 = node nyopetAutoTrader.js 2>&1 | Out-String
  Add-Content -Path $logFile -Value $output2 -Encoding utf8
} catch {
  Log "nyopetAutoTrader.js ERROR: $($_.Exception.Message)"
}

# Kaela Pro Trader -- eksekutor MULTI-AKUN (23 Agu 2026) -- JALAN TERAKHIR (butuh sniper-orders.json
# yang UDAH fresh dari cycle Olan barusan buat di-mirror ke member lain). Skip aman-sendiri kalau
# SERVICE_KEY belum diisi di secrets.js (lihat pesan errornya di log kalau mau cek).
try {
  $output4 = node multiAccountExecutor.js 2>&1 | Out-String
  Add-Content -Path $logFile -Value $output4 -Encoding utf8
} catch {
  Log "multiAccountExecutor.js ERROR: $($_.Exception.Message)"
}

$changed = git status --porcelain -- sniper-orders.json kaela-bankroll.json nyopet-journal.json
if ($changed) {
  Log 'Ada perubahan state -- push balik ke GitHub...'
  $ghToken = (Get-Content -Path (Join-Path $projectDir '.gh-token-mrolzgaming') -Raw).Trim()
  git add sniper-orders.json kaela-bankroll.json nyopet-journal.json
  git commit -m "Auto: sync eksekusi live (run-local-executor) $(Get-Date -Format 'yyyy-MM-dd HH:mm')" --quiet
  $authHeader = "Authorization: Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$ghToken")))"
  git -c http.extraHeader="$authHeader" push origin-new master --quiet
  Log 'Push selesai.'
} else {
  Log 'Gak ada perubahan state, gak perlu push.'
}

Log '--- Run selesai ---'
