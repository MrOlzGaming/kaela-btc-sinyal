# confirm-olan.ps1 -- gerbang konfirmasi fisik "beneran Olan yang di depan komputer" (6 Sep 2026,
# permintaan Olan: "setiap mau eksekusi perubahan, pastikan aku Olan.. jangan di chat ini.. trigger
# powershell atau apa gitu").
#
# 🐛 RISET PANJANG 6 Sep 2026 (dicatat detail biar SESI DEPAN GAK NGULANG semua percobaan ini):
# Olan awalnya minta Kaela SENDIRI yang mancing prompt PIN-nya (bukan Olan manual). Dicoba 3 lapis:
# 1. GUI (Windows Forms) dipicu langsung dari tool otomasi Kaela -- window "ada" secara proses tapi
#    SAMA SEKALI GAK KEGAMBAR di layar asli Olan (dicek screenshot computer-use Kaela sendiri pun
#    nunjukkin artefak beda dari yang Olan liat beneran -- gak bisa dipercaya buat verifikasi ini).
# 2. Riset (WebSearch) nemu penyebabnya: "Session 0 Isolation" (bug/desain Windows sejak Vista) --
#    proses dari konteks otomasi/service kejebak sesi TANPA LAYAR walau SessionId Windows KELIATAN
#    sama kayak sesi interaktif asli. Fix standar industri: Task Scheduler mode "Run only when user
#    is logged on" (`schtasks /it`), DIRANCANG buat nembus batasan ini.
# 3. Diimplementasi (`kaela-request-confirm.ps1`, sempat ada, sekarang DIHAPUS/dipindah trash) --
#    ketemu bug quoting `schtasks /tr` duluan (folder proyek ini ada spasi+"★", schtasks gagal
#    parse), itu DIPERBAIKI (launcher .cmd di path bebas-spasi), TAPI abis itu ketauan task-nya
#    "selesai" (`Last Result: 0`) DALAM HITUNGAN DETIK padahal isinya `Start-Sleep 15 detik` --
#    dites eksplisit (diagnostic task terpisah), TERBUKTI task interactive schtasks di environment
#    ini SAMA SEKALI GAK BENERAN JALAN (bukan bug kode, limitasi environment/sandbox itu sendiri).
# **KESIMPULAN FINAL: Kaela TIDAK BISA memicu prompt apapun (GUI ATAU scheduled task interactive)
# yang keliatan/beneran jalan di layar Olan lewat mekanisme Windows manapun yang udah dicoba di
# environment ini.** Kalau sesi depan kepikiran ide serupa lagi ("Kaela yang trigger prompt-nya"),
# baca bagian ini dulu SEBELUM coba lagi -- kemungkinan besar bakal kena limitasi yang sama.
#
# FIX/DESAIN FINAL (yang BENERAN jalan, dites): skrip ini WAJIB dijalankan OLAN SENDIRI (paste ke
# terminalnya sendiri yang dia buka/lihat langsung), BUKAN dipicu Kaela. Console prompt biasa
# (`Read-Host -AsSecureString`) di terminal yang OLAN SENDIRI buka -- itu genuinely interactive,
# gak kena masalah session/window-station apapun di atas karena bukan Kaela yang nge-spawn.
#
# PIN mentah TETAP GAK PERNAH keluar ke tempat yang bisa dibaca Kaela -- skrip ini nulis token
# hasil verifikasi (APPROVED/timestamp) ke file lokal, Kaela cuma baca file itu (ada/gak, masih
# baru/kadaluarsa), gak pernah baca PIN-nya sendiri dari mana pun.
#
# Hash PIN kesimpen LOKAL doang (.kaela-confirm-secret.hash, di-gitignore) -- REPO INI PUBLIC,
# commit hash PIN (apalagi PIN pendek/numerik) ke situ = bisa di-brute-force offline siapapun yang
# clone. Yang dicommit ke git CUMA skrip ini (logic-nya, biar "diinget GitHub" -- proyek tetap bisa
# lanjut walau komputer ini hancur), bukan secret-nya.
#
# Cara pakai (Olan jalanin SENDIRI di terminalnya):
#   .\confirm-olan.ps1 -Setup                              # sekali di awal, bikin PIN baru
#   .\confirm-olan.ps1 -ActionLabel "hapus folder X"        # minta konfirmasi PIN buat 1 aksi
# Token hasil (dibaca Kaela lewat file, BUKAN dari stdout skrip ini pas Olan yang jalanin):
#   D:\KAELA PROJECT\★ KAELA TRADING ENGINE ★\.kaela-confirm\approved.token
#   isinya 1 baris timestamp UTC -- Kaela anggap valid kalau file ada DAN umurnya < 5 menit,
#   HAPUS token itu abis dipakai sekali (gak bisa di-replay buat aksi berikutnya).

param(
  [switch]$Setup,
  [string]$ActionLabel = "aksi ini"
)

$secretPath = Join-Path $PSScriptRoot ".kaela-confirm-secret.hash"
$tokenDir = Join-Path (Split-Path $PSScriptRoot -Parent) ".kaela-confirm"
$tokenPath = Join-Path $tokenDir "approved.token"

function Get-PinHash {
  param([string]$Pin)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Pin)
  $hashBytes = $sha.ComputeHash($bytes)
  return [System.BitConverter]::ToString($hashBytes) -replace '-', ''
}

function Read-PlainPin {
  param([string]$Prompt)
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

if ($Setup) {
  Write-Host "=== Setup PIN konfirmasi Kaela ===" -ForegroundColor Cyan
  $pin1 = Read-PlainPin "Bikin PIN baru (bebas, beda boleh sama PIN Kaela Access)"
  if ([string]::IsNullOrEmpty($pin1)) { Write-Host "Dibatalkan." -ForegroundColor Yellow; exit 1 }
  $pin2 = Read-PlainPin "Ulangi PIN yang sama"
  if ($pin1 -ne $pin2) { Write-Host "PIN gak sama, coba lagi dari awal." -ForegroundColor Red; exit 1 }
  Set-Content -Path $secretPath -Value (Get-PinHash -Pin $pin1) -NoNewline
  Write-Host "OK -- PIN konfirmasi kesimpen. Kaela SEKARANG bisa minta kamu jalanin skrip ini tiap mau eksekusi aksi sensitif." -ForegroundColor Green
  exit 0
}

if (-not (Test-Path $secretPath)) {
  Write-Host "Belum pernah setup -- jalanin dulu: .\confirm-olan.ps1 -Setup" -ForegroundColor Yellow
  exit 2
}

$expectedHash = Get-Content -Path $secretPath -Raw
Write-Host "Kaela mau eksekusi: $ActionLabel" -ForegroundColor Cyan
$pin = Read-PlainPin "Masukin PIN konfirmasi (Ctrl+C buat batal)"

if ([string]::IsNullOrEmpty($pin)) { Write-Host "Dibatalkan." -ForegroundColor Yellow; exit 1 }

if ((Get-PinHash -Pin $pin) -eq $expectedHash) {
  if (-not (Test-Path $tokenDir)) { New-Item -ItemType Directory -Path $tokenDir -Force | Out-Null }
  (Get-Date).ToUniversalTime().ToString("o") | Set-Content -Path $tokenPath -NoNewline
  Write-Host "APPROVED -- Kaela boleh lanjut." -ForegroundColor Green
  exit 0
} else {
  Remove-Item -Path $tokenPath -ErrorAction SilentlyContinue
  Write-Host "PIN SALAH -- Kaela TIDAK boleh lanjut." -ForegroundColor Red
  exit 3
}
