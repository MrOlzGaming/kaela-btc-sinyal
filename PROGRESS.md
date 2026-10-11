# PROGRESS — Kaela Trader (baca ini DULUAN tiap chat baru)

> Catatan "baru aja kerjain apa", biar chat baru langsung nyambung TANPA baca ulang chat lama.
> Aturan: entri terbaru di ATAS, maksimal ±15 entri (yang lama dihapus, detailnya udah ada di git/memori).
> Detail lain: strategi → `STRATEGY-CATALOG.md`, nunggu/antrian → `GANTUNGAN.md`, trade → `TRADE-LEDGER.md`.

## 🎯 SEKARANG LAGI DI MANA

- **Topik aktif:** 🌾 FARMER (dulu "Grid Tangga") -- gridTrader.js mode LADDER, BingX BTC-USDC REAL isolated
- **Status:** LIVE (11 Okt). Tangga 6% saldo terbaru, 5x isolated, tambah tiap -15% (pas posisi -75%, sisa margin ditumpuk), TP = rugi + 30% total masuk. Nunggu saldo USDC
- **Pertanyaan terbuka ke Olan:** gak ada. Angka minCap/capExposure boleh diubah Olan kapan aja.
- **Langkah berikutnya:** cek kartu Dompet Farmer + jurnal Farmer di Kaela Access (Olan); deploy Netlify web Sniper NUNGGU izin Olan

## 📜 LOG (terbaru di atas)

- **11 Okt 12:02** — 🚫 PENUTUP POSISI ASING BingX LIVE (bingxPositionGuard.js): ETH-USDC LONG 0,01 tes Olan (real) ditutup paksa, Farmer aman.
  Penjaga Farmer dites Olan 11:20 (demo) & 11:26 (real): volume & target sama; margin sekarang DITAMBAH (BingX nolak dikurangin).

- **11 Okt 10:35** — Dompet Farmer = SALDO PENAMBAH (GAS v248): modal Farmer = saldo BingX asli + saldo eksternal (boleh kosong).
  Diisi $846 (total $940). Top up ngurangin angka di web otomatis. Pesan buka/nambah nampilin rincian modal. Antrian: pindah exchange.

- **11 Okt 10:25** — Kaela Access GAS v246+v247 LIVE (OAuth lewat Chrome Browser 2 / olz.gaming.master): kartu Dompet Farmer, jurnal Farmer,
  Ninja disembunyiin. Dompet Farmer diisi Manual $940 lewat setFarmerFundsForExecutor.

- **11 Okt 09:20-10:00** — Farmer REAL tangga #1 dibuka ulang $56,38 (acuan BingX $94 + cadangan bank $846). Fitur: cadangan bank, baca dompet
  kripto pribadi (selfCustodyWallet.js, alamat publik, 7 jaringan, kecek pakai alamat publik nyata), kartu "🌾 Dompet Farmer" di Kaela Access
  (GAS getFarmerFunds/setFarmerFunds/ForExecutor + JS sisip kartu) -- BELUM di-push GAS. Web Sniper: Farmer masuk, Ninja disembunyiin
  (di GitHub, BELUM deploy Netlify). Demo tangga #1 $24.018 @ $82.919.

- **11 Okt 08:46** — Farmer DEMO tangga #1 KEBUKA (G2026101101): 0,0036 BTC @ $82.923,5, margin $59,70, isolated 5x terverifikasi di BingX.
  Olan dikabarin WA pribadi 6282134510686.

- **11 Okt 10:00** — 🌾 FARMER DEMO jalan (node gridTrader.js demo, grid-demo-config.json, BingX demo VST BTC-USDT, aturan sama persis real,
  maxCap $1.000, saldo demo 400.323 VST -- Olan sebelumnya grid manual brutal 100k -> 300k+). NINJA dimatiin semua (MR/Exhaustion entryEnabled
  false, News enabled false; Olan: "gak cocok"), gak ada posisi kebuka. Ledger kenal Farmer demo (Olan Demo).

- **11 Okt 09:30** — Grid dinamain **🌾 FARMER** (tanam modal tiap tangga, panen, tanam ulang). Semua pesan pakai template darkKaelaLog
  (Buka/Nambah/Tutup), likuidasi tangga sekarang pesan "Tutup Posisi" standar + alasan. Selftest 11/11 + 12/12.

- **11 Okt 09:00** — Grid Tangga: modal per tangga SELALU dari saldo terbaru (top up/tarik di tengah siklus kebaca, selisih > max($5, 2%)),
  dipotong di maxCapUsd $1.000 (kebijakan cap $1000/dompet). Saldo > $1.050 -> DM Olan (maks 1x/7 hari) lebihnya bisa dipindah ke
  Sniper/Ranger/Ranger Rotasi (Kaela gak mindahin dana sendiri). Selftest 11/11.

- **11 Okt sore** — UJI BARENG LONG+SHORT (gridLifetimeStudy.js sweep 2.000+ kombinasi + validasi per jam): pilih long 6%/-15%/TP 30%
  (LIVE) + short 10%/+5%/TP10% (antrian 2029). Seumur hidup $1.000 -> $90.239 (32%/th, DD 74%, terendah $321); mulai 2018 $10.370 (31%/th).
  TP 50-70% & short 15% lebih gede di seumur hidup tapi per jam gak lebih bagus / DD short 55% -> ditolak (overfit).

- **11 Okt 12:30** — Setting LIVE diganti 6%/jarak 15% (cara manual Olan rebuy di -75%): seumur hidup $20.751 DD 74% terendah $299,
  peluru sampai ATH -96%. 8%/15% ($46.529) ditolak: 2011 saldo tinggal $15 (DD 99%). 10%/15% hancur.

- **11 Okt 12:00** — BACKTEST SEUMUR HIDUP (backtest/gridLifetimeStudy.js, harian 2010-08..2026-10, $1.000): KETEMU BUG LIVE -- abis
  likuidasi, tangga nunggu -20% dari entry; kalau harga mantul di antara -19,5% & -20% siklus MACET tanpa posisi (backtest macet
  2020-09..2026). FIX: abis liq tangga berikutnya LANGSUNG dibuka; tutup manual = siklus diakhiri + jeda 24 jam. Hasil: LONG+SHORT
  $1.000 -> $25.790 (22%/th, DD 85% di 2011, saldo terendah $175), LONG doang $17.151, SHORT doang $1.695. Sweep per jam gak berubah (8/20/5x).

- **11 Okt 11:00** — RISET TANGGA SHORT 1x + window halving (backtest/gridShortStudy.js): dipilih VERSI PELIT 5%/tangga tiap +10% (x1,66 DD 14%); versi +5%
  TP 10%, window hari 520-900 sejak halving -> x2,54, DD 25%, tiap bear untung. Window 2024 UDAH HABIS (6 Okt 2026) -> dipasang
  nanti (GANTUNGAN), window berikutnya ~Sep 2029. Sekarang hari ke-904 = zona dasar historis (777-924) -> fase tangga LONG.

- **11 Okt 10:00** — GRID TANGGA OTOMATIS: riset eksekusi 1 simbol (backtest/gridLotModeStudy.js): MERGE (tutup + buka lagi sisa
  margin + bet baru) x2,40 > lot virtual x2,31. Sweep -> 8%/jarak 20%/5x (x2,22, DD 60%, tahan sampai ATH -93%). Mode LADDER di
  gridTrader.js + selftest 7/7 (gridTrader.ladder.selftest.js), tradeLedger kenal grid_tangga. Mode ATH lama tetap ada (mode: ATH).

- **11 Okt 09:00** — Olan mulai grid manual dari $83.033 (paper $600, 5x isolated, margin 8% saldo TERBARU, tiap -17%, TP 20% margin
  masuk, COMPOUND). Backtest compound per tahun mulai: 2018 x8,07 (27%/th) .. 2022 x1,72 (12%/th) .. 2025 x1,08; TP ~6-16x/th.

- **11 Okt 08:30** — SKENARIO CRASH -90% (backtest/gridCrashScenario.js): aturan Olan (5x, 10%, -15%) MODAR di -90% (modal habis di -80%).
  Pemenang baru: **isolated 5x, margin 8% ($48), tambah tiap -17%** -> tahan -90% (12 posisi sampai -89%), data asli x2,31 (vs 2,55),
  terburuk x0,94, DD 65% (vs 80%), rungkad 0/94. Level dari ATH: -15/-29,5/-41,4/-51,4/-59,7/-66,5/-72,2/-76,9/-80,9/-84,1/-86,8/-89,1.

- **11 Okt 08:00** — RISET GRID MANUAL (backtest/gridManualStudy.js, 94 titik mulai): aturan ASLI Olan MENANG -- ISOLATED 5x,
  margin 10% modal, tambah tiap -15%, TP = margin yang udah kelikuidasi + 20% total margin masuk: median x2,55, rungkad 0/94,
  DD terburuk 80%. Saran Kaela sebelumnya (CROSS $40) SALAH: rungkad 51/94 -> dibatalin. Versi kalem: margin 5% x1,61 DD 41%.

- **10 Okt 22:20** — RISET minimal cap (`backtest/gridMinCapStudy.js`, 94 titik mulai): cap 2x HANGUS 41/94 (bahaya!) -> diganti
  **cap 1x**: CAGR median 25%, hangus 0/94, DD terburuk 89%. Tanpa minCap 15%/DD 59%. Grid belum pegang posisi pas diganti.

- **10 Okt malam** — Grid: MINIMAL CAP. Porsi = max(modal grid, minCap $830) biar rebuy tetap tiap 1% walau saldo kecil.
  Pengaman: volume dipotong pas di capExposure 2x ekuitas (dulu level dilewati). Config: `grid-config.json` minCap.

- **10 Okt 22:xx WITA** — Chat KAELA (TRADER) mentok kuota (7.529 pesan). Bikin sistem irit: file PROGRESS.md ini + aturan
  handoff ke chat baru. Chat TRADER lama dipensiunin.
- **10 Okt** — Grid: modal nyicil, top up kebaca otomatis dan porsi dikejar seolah modal udah ada dari awal (commit 57d7f019).
  Olan minta "minimal cap" (lihat pertanyaan terbuka).
- **9 Okt 23:20** — Grid ATH LIVE REAL (commit 506209be). DCA Tangga batal.

## 📋 PESAN SIAP COPY-PASTE KE CHAT BARU

```
Kaela, lanjut kerjaan Trader. Baca dulu PROGRESS.md di ★ KAELA TRADING ENGINE ★ (bagian "SEKARANG LAGI DI MANA"),
terus lanjutin dari situ. Jangan baca ulang chat lama.
```
