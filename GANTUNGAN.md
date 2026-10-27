# ⏳ GANTUNGAN / WAITING LIST — Kaela Trading Engine

> **Buat Kaela (sesi manapun):** Olan nanya "apa yang belum dikerjain / gantungan apa aja?" -> jawab dari file ini.
> Tiap ada kerjaan yang ketunda (nunggu Olan, nunggu tanggal, nunggu data) -> TAMBAH di sini. Udah beres -> pindah ke
> bagian "Selesai" paling bawah (tanggal + 1 baris). Permintaan Olan 3 Okt 2026: "catat sebagai gantungan/waiting list
> biar gak lupa". Katalog strategi ada di `STRATEGY-CATALOG.md`.

Terakhir diperbarui: **10 Okt 2026**.

## 🙋 NUNGGU OLAN (gak bisa dikerjain Kaela sendiri)

Keputusan Olan 3 Okt 2026 malam:
1. **Saldo real Bybit** — nanti (belum ada dana). Ranger Rotasi real nunggu ini.
2. **Bitget** — demo GAK dikejar lagi. Nanti langsung REAL begitu Olan isi saldo (key real udah tersambung, saldo $0,58).
   Key demo tetap tersimpan kalau suatu saat saldo demo baru bisa diisi.
3. ~~GRID ATH nunggu setoran USDC~~ -- BERES: sekarang 🌾 FARMER LIVE real (tangga #1 0,0034 BTC, modal $940 = BingX $94 + penambah $846). Setoran berikutnya kapan aja: top up kebaca otomatis.
4. ~~DCA Tangga~~ — DIBATALIN 9 Okt (diganti grid), monitor mati. Posisi Standard Futures sisa diurus Olan sendiri.
   Ninja real dimatiin lagi 8 Okt (balik uji demo).
5. **Saldo real Binance** — Olan nabung dulu (dashboard nyebut minimal ~$1.250 buat Sniper). (11 Okt: Olan DILARANG trading manual -- semua akun dikelola Kaela.)
6. **NETLIFY BELUM DIBAYAR (11 Okt)** -- akun Netlify "Restricted Team" (kredit habis), deploy ditolak ("Method Not Allowed"). Begitu Olan isi kredit: trigger deploy-daily.yml SEKALI buat semua perubahan numpuk: web Sniper (Farmer di dashboard+jurnal, metodologi-farmer.html, Ninja disembunyiin) + masking Kaela Access (dashboard.html: kartu Dompet Farmer, tombol metodologi Farmer). Kode udah di GitHub.
   (lama) **Izin deploy Netlify** — tiap update tampilan yang butuh upload ulang. (Antrian kosong -- metodologi-ninja News tayang 6 Okt.)
7. ~~Push GAS Kaela Access~~ -- BERES 6 Okt: GAS v245 live, 7 koneksi tersimpan, AdminView jalan, masking workflow dibenerin
   (YAML rusak sejak ~20 Sep); tampilan baru TAYANG 6 Okt 04:17 WITA lewat Netlify API langsung (GitHub Actions lagi gangguan).

## 📅 NUNGGU TANGGAL / DATA (Kaela cek sendiri pas waktunya)

- **Ninja News rilis berikutnya** — NYALA LAGI 11 Okt malam (demo doang, eksperimen). CPI Rabu 14 Okt 20:30 WITA, lalu Jobless Claims tiap Kamis. Cek
  `ninja-news.log` + `ninja-news-research-log.json` + laporan 30 menit ke grup beneran keluar.
  ISM 5 Okt (rilis pertama): detektor jalan normal, dolar cuma gerak 0,018%/menit -> gak entry (hasil ~sesuai perkiraan).
  Event MEDIUM lain masuk jadwal uji Ninja News atau gak -> diputusin dari riset `backtest/newsMediumStudy.js` (5 Okt).
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

- **TANGGA KEKAYAAN** (Olan 11 Okt, FINAL): 🌾 Farmer futures CAP $10.000 -> lebihnya bibit BTC spot -> grid SPOT BingX CAP $100.000 -> lebihnya beli DOGE -> DOGE ditarik Olan ke wallet pribadi tiap kali. ✅ DIBANGUN 11 Okt (spotGridTrader.js + spot-grid-config.json "doge"): grid spot lewat $100rb -> USDC lebihnya OTOMATIS dibeliin DOGE-USDC spot BingX (DCA maks $1.000/hari, sisain peluru 3 tangga grid), Olan dikabarin buat tarik DOGE ke dompet sendiri; musim puncak halving (hari 400-600) -> DM saran jual bertahap. Sisa (nunggu kejadian): baca saldo DOGE di dompet pribadi (selfCustodyWallet belum dukung Dogecoin -- tambah pas Olan udah punya DOGE). Pagar: cuma untung, bertahap, siap nol. TRANSISI BTC spot -> grid spot ($10rb): RISET BERES 11 Okt -> 30% BTC tetap DITAHAN (inti) + 70% jadi modal grid spot (19%/th, rugi cuma 5/94 titik, DD ~51%).

- **🎰 MOONSHOT 50/50 (rencana Olan 12 Okt, BELUM dibangun -- bangun pas grid spot mendekati $100rb):** kelebihan grid spot di atas $100rb: 50% WAJIB DOGE (kode sekarang masih 100% DOGE) + 50% LOTRE MANIA: $1 ke SEMUA koin spot terdaftar yang bisa lewat API (BingX 12 Okt: 612 koin, 590 USDT, min order ~$1, cuma 31 koin volume >$1jt/hari), DCA $1 tiap -25% (maks ~4x), begitu return $1 (2x) jual modal $1, sisanya tiket gratis (trailing). Butuh: konversi USDC->USDT, filter volume, tangani delisting. Backtest susah (koin mati ilang dari data).

- **MODE BANGKIT "kejar jumlah BTC"** (Olan 11 Okt): kalau Farmer rungkad & BTC masih jauh di bawah ATH -> setoran bulanan dipakai numpuk BTC spot (DCA tahan menang jauh dari grid, STRATEGY-CATALOG). RISET BERES 11 Okt: numpuk pas <= ATH -30% & DITAHAN (gak dijual) paling bagus; setoran balik ke Farmer begitu BTC di atas ATH -30%. Dijalanin manual-terarah (Kaela ngabarin, Olan beli BTC ke dompet sendiri) pas kejadian.

- **DCA GRID SPOT** (riset beres 11 Okt, STRATEGY-CATALOG): FINAL TANPA BUNGA 2%/-3%/x1,15/TP1,5% (±9-10%/th, DD 39%, tahan fee) -- Olan gak mau Earn/deposito/obligasi; cash dipegang sendiri, pakai pola saldo penambah. KEBIJAKAN Olan 11 Okt: Farmer (leverage) cap $10.000, untung di atasnya ngalir ke spot; grid spot ini cap $100.000 (lebihnya -> DOGE), lalu boleh mulai Farmer leverage BARU pakai modal kecil (mis. $1.000) -- Farmer = kantong pemula yang "lulus" ke spot.

- ~~🌾 Farmer pindah exchange kalau BingX rungkad~~ ✅ BERES 11 Okt sore: saklar `"exchange": "bingx" | "binance"` di grid-config.json.
  Ganti ke binance -> penjaga buka ulang tangga VOLUME SAMA di Binance (BTCUSDC), target tetap. BingX gagal diakses 30 menit
  berturut-turut -> Olan dapet DM saran pindah. Sisa (nunggu kejadian): saldo Binance harus diisi dulu; bibit otomatis cuma di BingX
  (di Binance balik ke notif manual). BELUM pernah dites live di Binance (selftest exchange palsu doang).

- ✅ **Tangga SHORT 1x = 🐻 FARMER SHORT -- DIBANGUN & DIJADWALKAN 11 Okt** (shortLadderTrader.js, real + demo, cron tiap menit, siaga sampai musim bear
  14 Sep 2029; Olan dikabarin 30 hari sebelumnya; selftest 10 lolos). Tanggal halving otomatis dari tinggi blok (halving.js) -- "verifikasi
  tanggal halving 2028" BERES (perkiraan 12 Apr 2028, tanggal asli diambil sendiri pas blok 1.050.000 ketambang). Sisa: belum pernah order
  live (nunggu musim). Riset aslinya: -- riset beres 11 Okt (STRATEGY-CATALOG), aturan FINAL (uji bareng long, 11 Okt sore): 10%/tangga, tambah tiap +5%, TP 10%, hari 520-900 + PENGAMAN: short gak dibuka/ditambah kalau total margin long+short > 70% ekuitas (11 Okt, gantiin ide zona ATH -30% Olan: zona -30% untung dari 2018 cuma $4.948 DD 58% vs batas margin 70% $9.654 DD 48%, margin maks 72%) (per jam x6,05, DD 47% di window 2018; versi pelit 5%/+10% x1,66 DD 14%). Pasang sebagai mode SHORT di gridTrader.js
  (hedge mode BingX, positionSide SHORT) SEBELUM window berikutnya: halving ~Apr 2028 (verifikasi tanggal pasti) + 520 hari = ~Sep 2029.
  Uji demo dulu (BingX demo BTC-USDT). Cek ulang riset pakai data siklus 2024-26 yang udah lengkap (dasar 2024 belum pasti).

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

## ⚠️ VPS Vultr: mesin TRADER tidak jalan sejak 17 Okt 2026 (temuan sesi KAELA (BC), 28 Okt 2026)
- `/root/kaela-engine/.git/index.lock` basi sejak 17 Okt 12.30 WITA -> `git reset --hard` di `run-vultr-executor.sh` GAGAL tiap siklus (1.035x) -> `report_and_exit` sebelum semua executor (localLiveExecutor, Sniper, Ranger, multiAccount, spot DCA, selfCheck, dll). Log: `local-executor.log` "git reset --hard GAGAL".
- Sudah diperbaiki (izin Olan): kebocoran /tmp (PRESERVE_DIR tanpa trap, ~855 MB/hari, disk sempat 88%) -> `trap ... EXIT` (GitHub a1d3b0c1 + file VPS), folder tmp.* lama dibersihkan, disk 49%.
- BELUM (menunggu Olan): hapus `.git/index.lock` -> mesin trading hidup lagi & bisa pasang order. Cek dulu working tree VPS (TRADE-LEDGER.md, analyst-dashboard.json kotor) dan apakah akun/strategi masih mau dinyalakan.
- Catatan: repo lokal TRADER tertinggal 104 commit dari GitHub (dan 2 commit lokal belum di-push) — sinkronkan di sesi TRADER.
- Keamanan: URL remote git (lokal & VPS) memuat token GitHub tertulis langsung; sebaiknya diganti ke credential helper.

### Pemeriksaan sesi KAELA (TRADER), 28 Okt 2026 07.30 WITA
- **Lock**: 0 byte, dibuat 17 Okt 12:30:03 WITA, tidak ada proses git jalan. Penyebab paling mungkin: proses git dihentikan paksa
  `timeout -k` saat memegang kunci (push hari itu sering timeout sejak 06.34; 2 cron — executor 15 mnt & econ-calendar 5 mnt — sama-sama
  menjalankan git di repo yang sama tanpa kunci bersama). Akibat sampingan: commit 06.34–12.30 17 Okt dibuang reset, tapi isi state-nya dijaga
  salinan PRESERVE, jadi tidak hilang.
- **Yang TETAP jalan selama 11 hari** (cron 1–5 menit, tidak lewat git reset): `run-channel-breakout-vultr.sh` (Ninja, Ninja MR/Exhaustion/
  News, Grid real+demo, Short-ladder real+demo, penjaga posisi BingX/Bybit/Bitget), `run-position-check-fast.sh` (Nyopet/Ranger cepat),
  `run-manual-open-check-vultr.sh`, `run-econ-calendar-live-vultr.sh` (commit-nya gagal terus karena lock). State mereka ada di working tree VPS.
- **Working tree VPS**: 30 file kotor — SEMUA ada di daftar `STATE_FILES` skrip (dijaga saat reset) kecuali `run-vultr-executor.sh`, yang isinya
  sudah SAMA dengan GitHub a1d3b0c1. Jadi menghapus lock TIDAK membuang state 11 hari. Untracked: `.channel-breakout-last-notified`,
  `executor-stuck-state.json`, `package-lock.json` (tak tersentuh reset).
- **Saldo real (cek 28 Okt, read-only)**: BingX futures real USDC/USDT $0, 0 posisi, spot ≈$0. Per 17 Okt: Bitget $0,58, Bybit $0,16,
  Binance/MEXC futures $0, Binance Spot (DCA) $48,90. Artinya kalau mesin hidup, order REAL hampir semuanya gagal karena saldo -> yang muncul
  notifikasi "saldo kurang" ke WA; demo tetap jalan.
- **Grid (Farmer) real**: posisi 0,0034 BTC ditutup DI LUAR SISTEM 17 Okt 23.39 WITA di $81.347 (rugi $1,99); sejak itu saldo BingX $0 dan
  penjaga menunggu top up ±$48 tiap menit (log berulang). PERTANYAAN untuk Olan: dana BingX ±$58 dipindah sendiri? Kalau iya, Grid real
  sebaiknya dimatikan resmi biar tidak menagih top up terus.
- Spot DCA: "di luar window beli, belum waktunya jual" -> tidak akan beli/jual saat dihidupkan.
- Kredit Vultr per 17 Okt: sisa $11,51 — cek lagi setelah mesin hidup (vultrBalanceMonitor ikut mati selama 11 hari).
- **Repo lokal**: cadangan branch `backup/lokal-sebelum-sync-2026-10-28`, rebase 2 commit lokal di atas GitHub (tanpa bentrok), push ->
  GitHub kini 9274074d (isi: teks alert saldo sebut nama bursa + migrasi deploy web ke CF Pages; workflow deploy manual saja). Kode ini baru
  dipakai VPS setelah lock dihapus.
- **Token**: lokal sudah punya helper `gh auth git-credential` (akun MrOlzGaming login) -> cukup ubah URL remote jadi
  `https://github.com/MrOlzGaming/kaela-btc-sinyal.git` (remote `origin` & `origin-new` dobel, bisa disatukan). VPS belum punya helper ->
  usul: token BARU fine-grained (hanya repo kaela-btc-sinyal, izin contents read/write), simpan di `~/.git-credentials` (chmod 600,
  `credential.helper store`), URL remote tanpa token, lalu cabut token lama (classic `ghp_`, scope luas). Sebagian awal token lama sempat
  tercetak di log alat sesi ini (bukan di chat) -> alasan tambahan untuk mengganti.
- **Rekomendasi**: hapus lock (aman, tidak ada proses git) lalu jalankan 1 siklus sambil dipantau; pertimbangkan perbaikan skrip:
  kunci bersama `flock` untuk semua skrip yang memakai git + hapus otomatis `index.lock` yang basi >10 menit (tanpa proses git) + alert WA.
  Menunggu "ya" Olan.
