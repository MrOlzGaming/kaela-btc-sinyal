# ⏳ GANTUNGAN / WAITING LIST — Kaela Trading Engine

> **Buat Kaela (sesi manapun):** Olan nanya "apa yang belum dikerjain / gantungan apa aja?" -> jawab dari file ini.
> Tiap ada kerjaan yang ketunda (nunggu Olan, nunggu tanggal, nunggu data) -> TAMBAH di sini. Udah beres -> pindah ke
> bagian "Selesai" paling bawah (tanggal + 1 baris). Permintaan Olan 3 Okt 2026: "catat sebagai gantungan/waiting list
> biar gak lupa". Katalog strategi ada di `STRATEGY-CATALOG.md`.

Terakhir diperbarui: **3 Okt 2026**.

## 🙋 NUNGGU OLAN (gak bisa dikerjain Kaela sendiri)

1. **Isi saldo real Bybit** (Funding -> Unified Trading) — Ranger Rotasi real nunggu ini. Gak mendesak, kapan siap.
2. **Saldo demo Bitget** -- key demo TERSAMBUNG (uid demo 27090010955, induk akun utama) tapi demo BARU (BTCUSDT/USDT, yg dipake
   API) saldonya 0 & gak ada tombol isi. Saldo 3.000 SUSDT ada di demo LAMA (SBTCSUSDT) yang API-nya udah dimatiin Bitget
   (V1 decommissioned, SBTCSUSDT "does not exist", 9+ endpoint saldo dicek kosong). Jalan keluar: tanya CS Bitget cara top up
   demo baru buat API, ATAU pakai Bitget real-only begitu ada saldo real. Sementara slot ICT Sweep TETAP di Binance.
3. **Anggaran DCA real** (`spot-live-config.json realBudgetUsd`, sekarang 0) — sebut angkanya kalau mau Compound Alt DCA /
   Musiman BTC belanja beneran. Window tanam alt mulai **19 Okt 2026**.
4. **Mulai DCA Tangga Leverage** BingX Standard Futures ($3/hari x3) — rencana **20 Okt 2026** (akhir window bear), buka
   manual (API cuma baca), Kaela pantau likuidasi otomatis.
5. **Izin deploy Netlify** — tiap update tampilan dashboard Kaela Access/BTC Sinyal yang butuh upload ulang.
6. **Isi saldo real Binance** (Sniper USDT / Ranger USDC) — semua leg real BTC udah siap, saldo $0 = skip aman.

## 📅 NUNGGU TANGGAL / DATA (Kaela cek sendiri pas waktunya)

- **14 Okt 2026 20:30 WITA** — rilis pertama Ninja News (CPI) di demo: cek `ninja-news.log` + `ninja-news-research-log.json`,
  pastikan detektor nyala & datanya kerekam. Lanjut tiap rilis di `news-schedule.json`.
- **Ninja News** — evaluasi setelah 1-2 bulan demo (target 30 rilis): naik real kalau hasil bagus.
- **Ninja Exhaustion** — evaluasi di **100 transaksi demo**: real kalau PF bersih > 1,2 dan gak ada paruh PF < 1.
- **Ninja MR 15M** — demo jalan; real cuma kalau demo berbulan-bulan jauh di atas impas.
- **Slot ICT Sweep Ranger** — pantau trade live pertama (log `[NyopetAutoTrader][Sweep]`), cek paritas sama backtest.
- **Sniper short window bear** — sampel cuma 20 trade, pantau terus.
- **Ranger Emas exit 1/2@3R** — n kecil, dipantau.
- **Desember 2026** — tambah jadwal rilis 2027 ke `news-schedule.json` (verifikasi Fed/BLS/BEA/Census). Jadwal FOMC Minutes &
  Beige Book belum dimasukin (tanggalnya belum diverifikasi).
- **Data radar** (likuidasi, order book, whale, miner, smart-money) — numpuk; revisit setelah beberapa bulan.

## 🛠️ KAELA KERJAIN (antrian)

1. Dashboard kosmetik (opsional): label sub-strategi Ninja (MR/Exhaustion/News) & kartu Rotasi, tampilan ledger spot real.
   Data transaksi UDAH masuk dashboard lewat jurnal (3 Okt) -- ini cuma tampilan, butuh deploy Netlify = izin Olan dulu.

## ✅ SELESAI (terbaru di atas)

- 3 Okt 2026 — Uji top trader (sizing volatilitas & pyramiding: DITOLAK, kalkulator exposure menang), validasi lookback x6
  (aman), filter volatilitas & jam (DITOLAK), jurnal Kaela Access buat Sniper/Ranger BTC dual-exec (sebelumnya gak nyatet).
- 3 Okt 2026 — Katalog strategi (`STRATEGY-CATALOG.md`), backup journal dual-exec ke git, kalibrasi Ninja News dari backtest
  per detik, leg real spot DCA (anggaran khusus), riset Bitget (butuh key demo), ICT sweep harian (gak robust).
