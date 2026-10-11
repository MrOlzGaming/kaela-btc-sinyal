# PROGRESS — Kaela Trader (baca ini DULUAN tiap chat baru)

> Catatan "baru aja kerjain apa", biar chat baru langsung nyambung TANPA baca ulang chat lama.
> Aturan: entri terbaru di ATAS, maksimal ±15 entri (yang lama dihapus, detailnya udah ada di git/memori).
> Detail lain: strategi → `STRATEGY-CATALOG.md`, nunggu/antrian → `GANTUNGAN.md`, trade → `TRADE-LEDGER.md`.

## 🎯 SEKARANG LAGI DI MANA

- **Topik aktif:** Grid TANGGA otomatis (gridTrader.js mode LADDER, BingX BTC-USDC REAL isolated)
- **Status:** LIVE (11 Okt). Bet 8% saldo terbaru, 5x isolated, tambah tiap -20%, TP = rugi kelikuidasi + 20% total bet. Nunggu saldo USDC masuk
- **Pertanyaan terbuka ke Olan:** gak ada. Angka minCap/capExposure boleh diubah Olan kapan aja.
- **Langkah berikutnya:** begitu USDC masuk: cek pesan Buka Posisi GRID + margin mode ISOLATED di BingX + TRADE-LEDGER kebaca

## 📜 LOG (terbaru di atas)

- **11 Okt 11:00** — RISET TANGGA SHORT 1x + window halving (backtest/gridShortStudy.js): pemenang 5%/tangga, tambah tiap +5%,
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
