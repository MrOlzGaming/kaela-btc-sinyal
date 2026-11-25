#!/bin/bash
# git-lock-guard.sh (26 Nov 2026) -- pembersih kunci git basi di VPS.
# Insiden: .git/index.lock 0 byte tertinggal 17 Okt 2026 (11 hari) dan 17 Nov 2026 23:45 (8 hari) -> `git reset --hard`
# run-vultr-executor.sh gagal TIAP siklus, semua eksekutor 15 menit gak jalan.
#
# Di-source oleh skrip cron yang jalanin git. WAJIB dipanggil HANYA sambil memegang /tmp/kaela-executor.lock,
# dari dalam folder repo. Kunci dihapus cuma kalau DUA-DUANYA benar: umur >= 10 menit DAN gak ada proses git
# (git, git-remote-https, git-gc, dst) yang jalan di mesin ini. Kalau pgrep gak ada/error -> gak dihapus.
# Alert lewat reportCycleErrors.js (Watchdog GAS -> WA; WA cuma sampai kalau akun Fonnte aktif).

GIT_LOCK_BASI_DETIK=600

# $1 = file log, $2 = nama sumber buat laporan
bersihkan_lock_git_basi() {
  local log_file="$1" sumber="$2" f umur sekarang pgrep_exit pesan
  for f in .git/index.lock .git/HEAD.lock .git/packed-refs.lock .git/refs/heads/master.lock .git/refs/remotes/origin-new/master.lock; do
    [ -f "$f" ] || continue
    sekarang=$(date +%s)
    umur=$(( sekarang - $(stat -c %Y "$f" 2>/dev/null || echo "$sekarang") ))
    [ "$umur" -ge "$GIT_LOCK_BASI_DETIK" ] || continue

    pgrep '^git' > /dev/null 2>&1
    pgrep_exit=$? # 0 = ada proses git, 1 = gak ada, lainnya = pgrep bermasalah
    if [ "$pgrep_exit" -ne 1 ]; then
      pesan="PERINGATAN kunci git basi $f (umur $((umur / 60)) menit) BELUM dihapus: masih ada proses git / pgrep bermasalah. Cek manual di VPS."
    elif rm -f "$f"; then
      pesan="PERINGATAN kunci git basi $f (umur $((umur / 60)) menit, tanpa proses git) dihapus otomatis."
    else
      pesan="PERINGATAN kunci git basi $f gak bisa dihapus. Cek manual di VPS."
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $pesan" >> "$log_file"
    timeout -k 10 30 node reportCycleErrors.js "$sumber" "$pesan" >> "$log_file" 2>&1 || true
  done
}
