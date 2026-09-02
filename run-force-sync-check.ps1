# run-force-sync-check.ps1 (31 Agu 2026) -- jadwal TERPISAH dari run-local-executor.ps1, jauh
# lebih rapat (~1 menit) KHUSUS buat ngecek permintaan "Minta Sinkron Sekarang" (tombol Developer
# Kaela Access). checkForceSyncRequest.js sendiri MURAH kalau gak ada permintaan (1 panggilan GAS
# doang, langsung selesai) -- aman dijadwal serapat ini. TIDAK nyentuh file lokal/git sama sekali
# (cuma HTTP ke Binance/MEXC/GAS), jadi AMAN jalan bebarengan sama siklus 15 menit biasa tanpa lock.
# 3 Sep 2026 -- checkManualOpenRequest.js NUMPANG jadwal SAMA (buka posisi manual Nyopet dari web,
# permintaan Olan: "gak usah nunggu 15 menit") -- alasan sama: murah kalau kosong, gak nyentuh git.
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$logFile = Join-Path $projectDir 'force-sync-check.log'

Set-Location $projectDir
try {
  $output = node checkForceSyncRequest.js 2>&1 | Out-String
  # Cuma tulis log kalau ADA aktivitas (permintaan ketemu) -- biar log gak numpuk baris "gak ada
  # permintaan" tiap menit selama berbulan-bulan.
  if ($output -notmatch 'Gak ada permintaan') {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $output"
    Add-Content -Path $logFile -Value $line -Encoding utf8
  }
} catch {
  Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR (force-sync): $($_.Exception.Message)" -Encoding utf8
}

try {
  $output2 = node checkManualOpenRequest.js 2>&1 | Out-String
  if ($output2 -notmatch 'Gak ada permintaan') {
    $line2 = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $output2"
    Add-Content -Path $logFile -Value $line2 -Encoding utf8
  }
} catch {
  Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR (manual-open): $($_.Exception.Message)" -Encoding utf8
}
