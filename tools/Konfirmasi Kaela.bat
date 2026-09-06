@echo off
REM Konfirmasi Kaela.bat -- gerbang PIN fisik (6 Sep 2026). Salinan RESMI ada di sini (git-tracked)
REM biar bisa dipulihin kalau salinan Desktop hilang (komputer rusak/diganti, dst) -- lihat
REM confirm-olan.ps1 + memori feedback-no-kaela-triggered-prompts buat konteks lengkap. Kaela
REM WAJIB cek: kalau "%USERPROFILE%\Desktop\Konfirmasi Kaela.bat" gak ada, copy file ini ke situ
REM DULU (otomatis, tanpa Olan perlu ngerti caranya), baru minta Olan klik.
title Konfirmasi Kaela
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f = Get-ChildItem 'D:\KAELA PROJECT' -Directory -Filter '*TRADING ENGINE*' | Select-Object -First 1; if (-not $f) { Write-Host 'Folder proyek gak ketemu.' -ForegroundColor Red } else { & (Join-Path $f.FullName 'tools\confirm-olan.ps1') }"
echo.
pause
