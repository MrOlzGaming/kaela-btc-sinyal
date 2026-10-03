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
6. **Izin deploy Netlify** — tiap update tampilan yang butuh upload ulang.

## 📅 NUNGGU TANGGAL / DATA (Kaela cek sendiri pas waktunya)

- **Kamis 8 Okt 2026 20:30 WITA** — rilis pertama Ninja News (Jobless Claims mingguan), lalu CPI 14 Okt. Di demo: cek `ninja-news.log` + `ninja-news-research-log.json`,
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
- **Data radar** (likuidasi, order book, whale, miner, smart-money) — numpuk; revisit setelah beberapa bulan.

## 🛠️ KAELA KERJAIN (antrian)

- (kosong) -- semua kerjaan Kaela beres 3 Okt 2026. Sisa: nunggu Olan / tanggal / data (di atas). Kandidat riset baru ada di
  STRATEGY-CATALOG.md bagian "IDE YANG BELUM DICOBA".

## ✅ SELESAI (terbaru di atas)

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
