# ⏳ GANTUNGAN / WAITING LIST — Kaela Trading Engine

> **Buat Kaela (sesi manapun):** Olan nanya "apa yang belum dikerjain / gantungan apa aja?" -> jawab dari file ini.
> Tiap ada kerjaan yang ketunda (nunggu Olan, nunggu tanggal, nunggu data) -> TAMBAH di sini. Udah beres -> pindah ke
> bagian "Selesai" paling bawah (tanggal + 1 baris). Permintaan Olan 3 Okt 2026: "catat sebagai gantungan/waiting list
> biar gak lupa". Katalog strategi ada di `STRATEGY-CATALOG.md`.

Terakhir diperbarui: **3 Okt 2026**.

## 🙋 NUNGGU OLAN (gak bisa dikerjain Kaela sendiri)

1. **Isi saldo real Bybit** (Funding -> Unified Trading) — Ranger Rotasi real nunggu ini. Gak mendesak, kapan siap.
2. **API key DEMO Bitget** — bikin dari mode Demo Trading Bitget, centang *Order futures* DAN *Open interest*, kirim lewat
   Kaela Access (bukan screenshot). Begitu ada: slot ICT Sweep pindah ke Bitget (exchange sendiri). Key real ditolak buat demo.
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

1. Uji prinsip top trader: ukuran posisi menurut volatilitas + pyramiding.
2. Ide lama: filter volatilitas, filter jam, validasi lookback Ranger.
3. Update dashboard Kaela Access (Exhaustion, News, slot Sweep, spot real) -> Netlify nunggu izin Olan.

## ✅ SELESAI (terbaru di atas)

- 3 Okt 2026 — Katalog strategi (`STRATEGY-CATALOG.md`), backup journal dual-exec ke git, kalibrasi Ninja News dari backtest
  per detik, leg real spot DCA (anggaran khusus), riset Bitget (butuh key demo), ICT sweep harian (gak robust).
