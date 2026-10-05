# Olan nanya soal strategi/ide trading? Buka [`STRATEGY-CATALOG.md`](STRATEGY-CATALOG.md) DULU

Katalog SEMUA strategi yang pernah dipelajari + hasil backtest terakhir + status (✅ dipakai / 🔬 observasi / ⏸️ disimpan /
❌ ditolak) + alasannya. Kalau idenya udah ada di situ -> presentasikan langsung dari situ, JANGAN riset/backtest ulang
(permintaan Olan 3 Okt 2026). Riset baru (lolos maupun gagal) WAJIB ditambah ke katalog.

# Review hasil trading / "trade kemarin gimana" / evaluasi metode? Buka [`TRADE-LEDGER.md`](TRADE-LEDGER.md)

Buku besar OTOMATIS (tradeLedger.js, tiap siklus VPS 15 menit) -- SEMUA trade Sniper/Ranger/Ninja, demo & real, semua
exchange: alasan buka & tutup (teks sama persis pesan WA), harga, SL, PnL kotor/fee/bersih, konteks entry lengkap. Data
mesin di `trade-ledger.json`. Permintaan Olan 5 Okt 2026: "catatan rapi & lengkap biar review & update gak kekurangan data".
Sistem/metode BARU wajib ikut kebaca di tradeLedger.js (jurnalnya WAJIB nyimpen riwayat trade yang udah tutup).

# Olan nanya "gantungan apa aja / apa yang belum"? Buka [`GANTUNGAN.md`](GANTUNGAN.md)

Waiting list: yang nunggu Olan, nunggu tanggal/data, dan antrian kerja Kaela. Kerjaan ketunda WAJIB dicatat di situ.

# Baca [`SYSTEM-MAP.md`](SYSTEM-MAP.md) DULUAN kalau kamu baru mulai kerja di folder ini

Peta navigasi sistem (status strategi terkini, peta file, aturan besi, arsitektur infra) --
WAJIB dibaca sebelum mulai kerja kalau belum ada konteks sesi sebelumnya. Update file itu tiap
ada perubahan besar (lihat ritual update di dalamnya sendiri).

# Identitas akun — baca sebelum sentuh GitHub/deploy di folder ini

Folder ini bagian dari ekosistem **"Kaela Trader"** (Kaela BTC Sinyal / Sniper / Nyopet).

**Akun kanonik: `olz.gaming.master@gmail.com`** (GitHub: `MrOlzGaming`). Ini SATU-SATUNYA akun
yang sah buat SEGALA HAL di folder ini — remote git, PAT/token, OAuth deploy, dll. Kalau nemu
remote/token/config nyasar ke akun lain (mis. `cvamaadm-bit` — itu punya proyek KLIEN lain,
AMA-TMS, bukan punya Olan sendiri) — itu SALAH, benerin ke `MrOlzGaming`/`olz.gaming.master`
langsung tanpa perlu tanya lagi.

Alasan (kata Olan, 6 Sep 2026): proyek ini harus bisa terus lanjut walau komputer rusak atau dia
gak bisa akses lagi — identitas akun yang konsisten & terdokumentasi di setiap folder adalah
bagian dari kontinuitas itu.

Detail lengkap (histori kejadian salah-akun, cakupan yang TIDAK termasuk proyek klien, dll) ada
di memori: `reference-kaela-canonical-account` dan `reference-github-account-kaela-trading-engine`.
