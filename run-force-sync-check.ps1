# run-force-sync-check.ps1 (31 Agu 2026) -- jadwal TERPISAH dari run-local-executor.ps1, jauh
# lebih rapat (~1 menit) KHUSUS buat ngecek permintaan "Minta Sinkron Sekarang" (tombol Developer
# Kaela Access). checkForceSyncRequest.js sendiri MURAH kalau gak ada permintaan (1 panggilan GAS
# doang, langsung selesai) -- aman dijadwal serapat ini. TIDAK nyentuh file lokal/git sama sekali
# (cuma HTTP ke Binance/MEXC/GAS), jadi AMAN jalan bebarengan sama siklus 15 menit biasa tanpa lock.
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
  Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR: $($_.Exception.Message)" -Encoding utf8
}
