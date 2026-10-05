# ⏳ GANTUNGAN / WAITING LIST — Kaela Trading Engine

> **Buat Kaela (sesi manapun):** Olan nanya "apa yang belum dikerjain / gantungan apa aja?" -> jawab dari file ini.
> Tiap ada kerjaan yang ketunda (nunggu Olan, nunggu tanggal, nunggu data) -> TAMBAH di sini. Udah beres -> pindah ke
> bagian "Selesai" paling bawah (tanggal + 1 baris). Permintaan Olan 3 Okt 2026: "catat sebagai gantungan/waiting list
> biar gak lupa". Katalog strategi ada di `STRATEGY-CATALOG.md`.

Terakhir diperbarui: **3 Okt 2026**.

## 🙋 NUNGGU OLAN (gak bisa dikerjain Kaela sendiri)

Keputusan Olan 3 Okt 2026 malam:
1. **Saldo real Bybit** — nanti (belum ada dana). Ranger Rotasi real nunggu ini.
2. **Bitget** — demo GAK dikejar lagi. Nanti langsung REAL begitu Olan isi saldo (key real udah tersambung, saldo $0,58).
   Key demo tetap tersimpan kalau suatu saat saldo demo baru bisa diisi.
3. **DCA real** — BUKAN spot DCA. Olan DCA sendiri BTC long x3 di **BingX Standard Futures** ~Rp50.000/hari (tiap posisi
   independen, berlapis-lapis). `spot-live-config.json realBudgetUsd` TETAP 0 (leg real spot DCA diem). Catatan: Rp50rb ≈
   $2,80 (kurs 17.883) x3 = $8,39 < min 0,0001 BTC (~$8,48) -> saran margin >= ~Rp55rb.
4. **DCA Tangga** — Kaela CUMA mantau (`stdFuturesLadderMonitor.js`, tiap menit): posisi kelikuidasi -> DM WA Olan, Olan
   ganti posisi sendiri. Rencana riset mulai 20 Okt 2026 (akhir window bear).
5. **Saldo real Binance** — Olan nabung dulu (dashboard nyebut minimal ~$1.250 buat Sniper). Sementara Olan trading manual di
   luar sistem (BC.Game, fee 0, copet news) -- Kaela gak perlu ngurusin itu.
6. **Izin deploy Netlify** — tiap update tampilan yang butuh upload ulang. Antri: `web/js/kaela-render.js` liquidationPrice
   masih rumus lama 100/leverage (tanpa maintenance margin, 5 Okt) -- disamain sama darkKaelaLog.js pas deploy berikutnya.

## 📅 NUNGGU TANGGAL / DATA (Kaela cek sendiri pas waktunya)

- **Senin 5 Okt 2026 22:00 WITA** — rilis pertama Ninja News = ISM Services PMI (ditambah 5 Okt atas pertanyaan Olan; ISM
  Manufaktur/Jasa juga 2/4 Nov & 1/3 Des). Lalu Jobless Claims Kamis 8 Okt 20:30 WITA, CPI 14 Okt. Di demo: cek `ninja-news.log` + `ninja-news-research-log.json`,
  pastikan detektor nyala & datanya kerekam. Lanjut tiap rilis di `news-schedule.json`.
- **Ninja News** — evaluasi setelah 1-2 bulan demo (target 30 rilis): naik real kalau hasil bagus.
- **Ninja Exhaustion** — evaluasi di **100 transaksi demo**: real kalau PF bersih > 1,2 dan gak ada paruh PF < 1.
- **Ninja MR 15M** — demo jalan; real cuma kalau demo berbulan-bulan jauh di atas impas.
- **Slot ICT Sweep Ranger** — pantau trade live pertama (log `[NyopetAutoTrader][Sweep]`), cek paritas sama backtest.
- **Sniper short window bear** — sampel cuma 20 trade, pantau terus.
- **Ranger Emas exit 1/2@3R** — n kecil, dipantau.
- **Desember 2026** — tambah jadwal rilis 2027 ke `news-schedule.json` (verifikasi Fed/BLS/BEA/Census). Jadwal FOMC Minutes &
  Beige Book belum dimasukin (tanggalnya belum diverifikasi).
- **Pertama kali Olan tambah collateral** di BingX Standard Futures -- cek di `std-futures-ladder-state.json` apakah `margin` posisi
  ikut naik (asumsi: field `initialMargin` allPosition ke-update). Kalau gak, cari field lain biar leverage efektif & harga
  likuidasi perkiraan ikut bener. Peringatan collateral (-50% / -75% margin) aktif sejak 3 Okt.
- **Kredit server Vultr** -- $13,89 per 4 Okt (~$0,17/hari) -> cukup sampai ~akhir Des 2026. vultrBalanceMonitor.js otomatis nagih
  ke grup Wibowo tiap hari begitu < $5 (~akhir Nov). Olan top up di vultr.com sebelum itu.
- **Data radar** (likuidasi, order book, whale, miner, smart-money) — numpuk; revisit setelah beberapa bulan.
- **Awal Januari 2027** — jalanin ulang `backtest/fundingExtremeStudy.js` (data funding baru + candle 5m baru): edge "long pas funding
  paling rendah" kuat 2020-24 tapi mati 2025-26. Kalau kuartal terbaru balik positif di dataran parameter -> kandidat uji demo Ninja.

## 🛠️ KAELA KERJAIN (antrian)

- Kandidat riset baru lainnya ada di STRATEGY-CATALOG.md bagian "IDE YANG BELUM DICOBA".

## ✅ SELESAI (terbaru di atas)

- 5 Okt 2026 siang — FIX Ninja MR nol trade (0057, limit dari harga Binance spot ditolak BingX) -> trade pertama #2026100501
  LONG demo kebuka normal (SL native + limit TP terverifikasi di BingX). Likuidasi di pesan sekarang angka asli exchange / rumus
  + maintenance margin (review Olan: pesan $84.009 vs BingX $84.388,6). Selisih harga antar bursa diukur (semua < 0,1%) --
  Sniper/Ranger aman. Paritas Sniper dual-exec: trailing 3x sesuai validasi.

- 5 Okt 2026 — Filter DXY Ranger BTC DICABUT (Olan: "ikut saranmu"; uji ulang exit live: filter motong untung dua era); Emas
  tetap. Alarm palsu whale timeout dibereskan (fetchWithRetry timeout 30 dtk + alarm cuma kalau scan ketinggalan > 72 blok).
  Test regresi 0056 & DXY (105 lolos). Audit paritas Fed Dovish Grid: picu layer beda (rata2 vs layer terakhir) tapi live lebih
  untung -- dibiarin.

- 4 Okt 2026 pagi (lanjutan kerja mandiri) — Audit: SelfCheck harian balik HIJAU (regression 103/103 di salinan bersih -- crash
  require tanpa secrets dibenerin; BingX 14/14 -- getOrder abis cancel ternyata cuma telat ~1,5 dtk, diukur di demo); sync git VPS
  gak nyampah lagi (push retry + econ-calendar gak alarm palsu); Ninja News dikunci 1 detektor per rilis (cegah entry dobel pas
  20:30 bareng reset executor); rapor uji demo Senin digeser ke >= 09:00 WITA. BUG_REGISTRY 0052-0056. Riset Ninja: CME Gap Fill
  DITOLAK (mitos), Funding Ekstrem DISIMPAN (kuat 2020-24, mati 2025-26), efek kalender (Senin+Rabu kandidat tipis, gak dipasang).
  Riset Emas: Donchian window DITOLAK -- tapi dari situ KETEMU bug laten Ranger Emas (tutup paksa window padahal Emas udah
  tanpa window; backtest PF 4,29 -> 1,11) -> DIBENERIN sebelum MEXC diisi. FedGrid crash path (2 Okt) dibenerin.

- 4 Okt 2026 subuh (kerja mandiri pas Olan tidur) — Audit: FIX SL/TP algo Binance & plan order MEXC nyangkut abis cancel (TERBUKTI
  di demo; bersihin 1 TP basi di demo Nirwan; akun real Binance/MEXC dicek bersih); listener likuidasi dicek sehat. Riset: filter
  Fear & Greed buat slot ICT Sweep (skip short pas F&G < 25 -> PF 1,45/1,55 jadi 1,87/1,81) DIPASANG. BUG_REGISTRY 0047-0051.
- 4 Okt 2026 — Rapor Uji Demo otomatis (`trialReport.js`): Senin ke grup Wibowo + tonggak penilaian otomatis (Exhaustion 100 /
  News 30 transaksi). Evaluasi di bagian NUNGGU TANGGAL sekarang dilaporin sistem sendiri, gak bergantung sesi Kaela.
- 4 Okt 2026 dini hari — Health check: (1) FIX laten serius: state cron menit (Ninja MR/Exhaustion/News, DCA Tangga, leg demo
  scalp) gak ilang lagi kena git reset --hard eksekutor (STATE_FILES dijaga, terverifikasi live 00:15 "State lokal 1 file dijaga");
  (2) alat verifikasi endpoint BingX diperbaiki (qty 0) -> 13/14 lolos di demo asli (sisa: getOrder abis cancel kadang "order not
  exist", udah ditangani eksekutor); (3) template pesan WA seragam + rapi per baris; (4) Jobless Claims mingguan masuk jadwal News.
- 3 Okt 2026 — Label sub-strategi di dashboard: TERPENUHI lewat kolom Note jurnal ("Ninja Exhaustion · ...", "Ninja News · ...",
  "Ranger BTC · ICT Liquidity Sweep") yang otomatis tampil sbg alasan posisi -- tanpa ubah kode/Netlify. Kartu Rotasi & tampilan
  ledger spot real nunggu ada datanya (Bybit real / anggaran DCA).

- 3 Okt 2026 — Uji top trader (sizing volatilitas & pyramiding: DITOLAK, kalkulator exposure menang), validasi lookback x6
  (aman), filter volatilitas & jam (DITOLAK), jurnal Kaela Access buat Sniper/Ranger BTC dual-exec (sebelumnya gak nyatet).
- 3 Okt 2026 — Katalog strategi (`STRATEGY-CATALOG.md`), backup journal dual-exec ke git, kalibrasi Ninja News dari backtest
  per detik, leg real spot DCA (anggaran khusus), riset Bitget (butuh key demo), ICT sweep harian (gak robust).
