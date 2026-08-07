# Deploy web/ ke Netlify — pakai netlify-cli (sudah terpasang global), non-interaktif via token.
# Akun target: olz.gaming.master@gmail.com, team "olz-gaming-master" -- proyek ini SENDIRI,
# terpisah dari akun/proyek Netlify lain. Token WAJIB digenerate dari akun itu.
#
# Cara pakai:
#   1. Login ke app.netlify.com sebagai olz.gaming.master@gmail.com
#      -> buat Personal Access Token di User settings > Applications > Personal access tokens
#   2. Deploy pertama kali (bikin site baru):
#        .\tools\deploy-netlify.ps1 -Token "nfp_xxxxx" -SiteName "kaela-btc-sinyal"
#   3. Deploy berikutnya (situs sudah ada, tinggal update):
#        .\tools\deploy-netlify.ps1 -Token "nfp_xxxxx" -SiteId "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
#      (SiteId dicetak di layar pas deploy pertama — simpan itu)
#
# Setelah deploy PERTAMA kali sukses, WAJIB update WEB_URL di config.js (project root)
# ke URL asli yang dicetak di bawah, supaya semua Report/News/Sinyal link ke situs yang benar.

param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$SiteName = "kaela-btc-sinyal",
  [string]$SiteId = "",
  [string]$AccountSlug = "olz-gaming-master"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WebDir = Join-Path $ProjectRoot "web"

if (-not (Test-Path $WebDir)) {
  Write-Error "Folder web/ gak ditemukan di $WebDir"
  exit 1
}

$env:NETLIFY_AUTH_TOKEN = $Token

if (-not $SiteId) {
  Write-Host "=== Belum ada SiteId, bikin site baru: $SiteName (team: $AccountSlug) ==="
  $createRaw = netlify sites:create --name $SiteName --account-slug $AccountSlug --json 2>&1
  Write-Host $createRaw
  try {
    $created = $createRaw | ConvertFrom-Json
    $SiteId = $created.id
  } catch {
    Write-Error "Gagal parse output netlify sites:create. Cek pesan di atas (mungkin nama '$SiteName' sudah dipakai orang lain -- coba -SiteName lain)."
    exit 1
  }
  Write-Host "Site baru dibuat. SiteId: $SiteId  -- SIMPAN INI buat deploy berikutnya."
}

Write-Host "=== Deploy web/ ke Netlify (site: $SiteId) ==="
$deployRaw = netlify deploy --dir="$WebDir" --prod --site $SiteId --json 2>&1
Write-Host $deployRaw

try {
  $deployed = $deployRaw | ConvertFrom-Json
  Write-Host ""
  Write-Host "=== SUKSES ==="
  Write-Host "URL live      : $($deployed.url)"
  Write-Host "SiteId        : $SiteId"
  Write-Host ""
  Write-Host "-> Update WEB_URL di config.js ke URL di atas kalau ini deploy PERTAMA kali."
} catch {
  Write-Host "Deploy selesai tapi output bukan JSON valid -- cek log di atas manual."
}
