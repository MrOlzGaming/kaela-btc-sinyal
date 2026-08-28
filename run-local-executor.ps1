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

# 28 Agu 2026 -- insiden nyata: git push nyangkut TANPA batas waktu (bukan error, diem aja), dan
# kill proses INDUK (powershell.exe) TERNYATA GAK ikut matiin proses ANAK git.exe-nya -- 2 push
# jadi zombie bareng >23 jam, `MultipleInstances: IgnoreNew` bikin SEMUA siklus 15-menit berikutnya
# di-skip DIAM-DIAM tanpa log error apapun. Fix: WAJIB timeout eksplisit + `taskkill /T` (matiin
# SELURUH process tree, bukan cuma proses utama -- .NET Process.Kill() PS 5.1 gak bisa tree-kill).
function Invoke-GitTimeout {
  param([string[]]$GitArgs, [int]$TimeoutSec = 30)
  # 28 Agu 2026: `Start-Process -PassThru` (cmdlet) ternyata ExitCode-nya GAK RELIABLE di PS 5.1
  # (ketauan langsung pas tes -- HasExited=True tapi ExitCode kosong). Pindah ke .NET
  # System.Diagnostics.Process murni (bukan cmdlet) -- lebih rendah level, ExitCode konsisten.
  # Baca stdout/stderr ASYNC (bukan nunggu proses exit dulu baru baca) -- kalau nunggu sinkron,
  # proses anak bisa DEADLOCK kalau OS pipe buffer-nya penuh sebelum sempat dibaca.
  $argLine = ($GitArgs | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'git'
  $psi.Arguments = $argLine
  $psi.WorkingDirectory = $projectDir
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  $stderrTask = $proc.StandardError.ReadToEndAsync()
  [void]$proc.StandardOutput.ReadToEndAsync()
  if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
    Start-Process -FilePath 'taskkill' -ArgumentList "/PID $($proc.Id) /T /F" -NoNewWindow -Wait -ErrorAction SilentlyContinue
    throw "git $($GitArgs -join ' ') TIMEOUT setelah ${TimeoutSec}s -- proses (+anak2nya) dipaksa berhenti paksa."
  }
  $proc.WaitForExit()
  if ($proc.ExitCode -ne 0) {
    throw "git $($GitArgs -join ' ') gagal, exit code $($proc.ExitCode): $($stderrTask.Result)"
  }
}

Set-Location $projectDir
Log '--- Run mulai ---'

try {
  Invoke-GitTimeout -GitArgs @('pull', 'origin-new', 'master', '--quiet') -TimeoutSec 30
  Log 'git pull sukses.'
} catch {
  Log "git pull GAGAL (kemungkinan belum ada internet, atau timeout) -- coba lagi run berikutnya: $($_.Exception.Message)"
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

# Compound Alt DCA -- eksekusi live (29 Agu 2026) -- spotDcaAlt.js (cloud, GitHub Actions) cuma
# nyatet RENCANA beli/jual bulanan ke pendingLiveBuy/pendingLiveSell, no-op kalau gak ada yang
# baru (paling sering, cuma aktif tanggal 5 pas window Musim Tanam -- mulai 19 Okt 2026).
try {
  $output5 = node spotAltLiveExecutor.js 2>&1 | Out-String
  Add-Content -Path $logFile -Value $output5 -Encoding utf8
} catch {
  Log "spotAltLiveExecutor.js ERROR: $($_.Exception.Message)"
}

$changed = git status --porcelain -- sniper-orders.json kaela-bankroll.json nyopet-journal.json kaela-spot-alt.json
if ($changed) {
  Log 'Ada perubahan state -- push balik ke GitHub...'
  # Per-file safe (29 Agu 2026, nambah kaela-spot-alt.json -- file itu BELUM TENTU ada dulu sampai
  # buy pertama kejadian, 19 Okt 2026+. `git add fileA fileB` CRASH TOTAL kalau salah satu gak ada
  # -- pola sama kayak bug git-add-f di workflow GH Actions, dicegah di sini juga).
  foreach ($f in @('sniper-orders.json', 'kaela-bankroll.json', 'nyopet-journal.json', 'kaela-spot-alt.json')) {
    if (Test-Path $f) { git add $f }
  }
  git commit -m "Auto: sync eksekusi live (run-local-executor) $(Get-Date -Format 'yyyy-MM-dd HH:mm')" --quiet
  # 28 Agu 2026, bug NYATA ketemu langsung: dulu masukin -c http.extraHeader pakai token DARI FILE
  # (.gh-token-mrolzgaming) yang BEDA dari token yang udah ketanam di URL remote origin-new sendiri
  # -- 2 kredensial numpuk bikin git bingung & nyoba prompt password interaktif, NYANGKUT SELAMANYA
  # (>23 jam sekali kejadian, gak ada di sesi manapun yang keliatan) krn "terminal prompts disabled".
  # Fix: remote origin-new UDAH BAWA token sendiri (`git remote set-url`, permanen) -- push POLOS aja.
  try {
    Invoke-GitTimeout -GitArgs @('push', 'origin-new', 'master', '--quiet') -TimeoutSec 30
    Log 'Push selesai.'
    # Purge jsDelivr (29 Agu 2026, bug ketemu: cuma workflow GitHub Actions yang purge CDN,
    # executor LOKAL ini nge-push tapi gak pernah purge -- web bisa nunjukkin saldo/posisi basi
    # sampai 12 jam walau data di GitHub udah fresh. Root cause dari beberapa laporan "ghost
    # position"/"saldo belum konek" Olan yang ternyata cache doang. Sama pola kayak workflow YAML.
    foreach ($f in @('sniper-orders.json', 'kaela-bankroll.json', 'nyopet-journal.json')) {
      try { Invoke-WebRequest -Uri "https://purge.jsdelivr.net/gh/MrOlzGaming/kaela-btc-sinyal@master/$f" -UseBasicParsing -TimeoutSec 10 | Out-Null } catch {}
    }
    Log 'Purge jsDelivr selesai.'
  } catch {
    Log "Push GAGAL/timeout (state ke-commit lokal tetap, dicoba lagi push polos siklus berikutnya): $($_.Exception.Message)"
  }
} else {
  Log 'Gak ada perubahan state, gak perlu push.'
}

Log '--- Run selesai ---'
