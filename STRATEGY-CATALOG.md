# 📒 KATALOG STRATEGI KAELA — semua yang pernah dipelajari & di-backtest

> **Buat Kaela (sesi manapun):** kalau Olan nanya soal strategi/ide trading APAPUN ("pernah nyoba X?", "kenapa gak pakai Y?",
> "hasil backtest Z gimana?") -> **CARI DI FILE INI DULU** sebelum riset/backtest ulang. Kalau ada: presentasikan status,
> angka terakhir, dan alasannya langsung dari sini. Detail lengkap + command regenerate ada di `BACKTEST-REGISTRY.md`
> (dan `RESEARCH-LOG.md` buat riset sebelum 1 Okt). Riset BARU -> WAJIB tambah entri di sini (status + angka + alasan + file).
>
> Permintaan Olan (3 Okt 2026): "semua strategi yang udah dipelajari, kalau aku tanya lagi langsung ingat dan bisa
> presentasikan hasil backtest terakhir.. kalau aku lupa kamu gak perlu belajar dan backtest lagi.. tandai mana yang dipakai,
> tidak, atau masih observasi."

**Tanda status:**
- ✅ **DIPAKAI** = jalan otomatis (demo, dan real kalau saldo cukup)
- 🔬 **OBSERVASI** = jalan di demo / ngumpulin data, real belum (nunggu bukti)
- ⏸️ **DISIMPAN** = udah dibangun/lolos sebagian, sengaja belum dinyalain
- ❌ **DITOLAK** = udah diuji, gak layak (alasan di bawahnya)

Satuan: **PF** = untung kotor / rugi kotor (di atas 1 = untung). **R** = kelipatan risiko per trade. "2 era" = dinilai terpisah
sebelum 2023 dan sesudah 2023 (biar gak ketipu kebetulan). Fee BingX/Binance ~0,1% bolak-balik kecuali disebut lain.

Terakhir diperbarui: **3 Okt 2026**.

---

## 🧮 FONDASI (dipakai semua sistem)

- ✅ **Kalkulator Exposure** (`calculator.js hitung()`) — exposure dari tabel modal, leverage = 100/nyawa%, SL via likuidasi
  isolated (cap 50x). Short & alt otomatis separuh. **Produk unggulan #1** (kata Olan).
- ✅ **Trailing 3x invalidasi buat BTC** — SL ngikut harga terbaik, jaraknya 3x jarak SL awal, cuma maju, tanpa TP.
  Ranger BTC 4H PF 3,15/2,87 vs 2,72/2,04 (exit lama); Sniper 2023-26 CAGR 129% vs 99%, DD 27% vs 33%. **Produk unggulan #2.**
- ❌ **Trailing 1x invalidasi** (contoh asli Olan) — kalah di semua aset: kena "gocek" kecil terus, drawdown gak turun. 2x juga kalah.
- ✅ **Exit alt** = ambil 1/3 di 2R -> SL sisa ke BE -> trail SMA60 4H (menang 2 era di rotasi 8 koin). Trailing murni kalah di alt.
- ✅ **Exit emas** = ambil 1/2 di 3R -> trail SMA60 (n kecil, dipantau). Trailing & early-BE malah ngerusak emas.
- ❌ **Early-BE terpisah** (SL ke entry pas +1,5R) — bantu dikit BTC, rusak emas; ketutup trailing 3x.
- ✅ **Ukuran alt = exposure /2** (ide Olan) — rotasi 8 koin DD 2019-22 turun 81% -> 55%, CAGR 90% -> 84%.
- ✅ **Short exposure = separuh long** — divalidasi 14 Sep: hasil akhir beda tipis, kekhawatiran awal = artefak modal $100.
- ❌ **Money management "Secure/Compound + target 2x" (v1, v2, v3)** — flaw struktural; v3 (50% profit balik ke modal) nolong
  BTC tapi strategi win-rate rendah (Nyopet Emas 16%) tetap habis. Gak dipakai.

---

## 🎯 SNIPER (BTC harian, Binance USDT)

- ✅ **Sniper chart-pattern + FVG harian, window halving** — PF 2,97, $100 -> $31.045 (2017-2026). Long 46 trade, short
  window-bear 20 trade (tipis, dipantau).
  Demo+real paralel (`sniperBtcDualExec.js`), exit trailing 3x.
- ✅ **Short BTC window bear** (auto) — sampel tipis, tetap jalan (arahan Olan).
- ℹ️ **Sniper Emas: gerbang long pas < SMA200 harian** (cek paritas 4 Okt, `backtest/sniperGoldWindowParity.js`, flag+wedge
  2010-26) — konfigurasi live (gerbang long, tanpa short, tanpa tutup paksa) vs buy-only polos: PF sedikit lebih tinggi (1,42 vs
  1,31; trailing 3x 2,26 vs 1,83) tapi total R lebih kecil (12 vs 18 / 21,6 vs 28) krn trade separuh. Trade-off wajar, sesuai
  arahan Olan ("window habis jangan long") -- gak diubah. (Beda dari Ranger Emas yang ketemu bug tutup paksa, 0056.)
- ❌ **Filter DXY buat Sniper** — gagal rigor (split-era + sensitivitas). Cuma Ranger yang dapet filter DXY.
- ❌ **Short Emas (Sniper/Ranger)** — window-gated jelek ($4.500 vs baseline $11.469, whipsaw SMA200); pengganti pakai posisi
  COT Commercial juga gak robust; ADX gate gagal split-era; real-yield/minyak cuma informasional. Sinyal info-only juga
  dimatikan 3 Okt (arahan "ragu tinggal").
- ❌ **ICT sweep harian** (sapu low/high 5-10 hari + close balik, searah tren SMA50) — kelihatan bagus (PF 1,6-1,9 dua era), TAPI
  vs entry ACAK cuma 1 varian yang beda nyata (swing5 trail1 p=0,03); tetangganya (trail2 p=0,20, swing10 p=0,12, trail3 p=0,46)
  gak beda dari acak -> gak robust, gak dipasang (3 Okt, `ict-sweep-1d-validate-output.log`).

## 🏹 RANGER (4 jam)

- ✅ **Ranger BTC chart-pattern + FVG 4H** (Binance USDC, 2 slot) — n=90, win 47,8%, PF 3,71, $100 -> $2.319, DD 39,9%;
  era 2018-20 PF 4,00 / 2021-25 PF 3,34. Divalidasi 2 metode independen (Deflated Sharpe PSR 99,9% + bar permutation
  p=0,025) = bukti terkuat dari semua strategi live. Filter DXY DICABUT 5 Okt (motong untung di exit trailing 3x). Demo+real (`rangerBtcDualExec.js`), trailing 3x.
- ✅ **Ranger slot ke-3: ICT liquidity sweep 4H** (3 Okt) — candle nyapu low/high 20 candle lalu close balik, searah tren
  SMA300, SL ujung sapuan, trailing 3x. 2 arah PF 1,45 (2019-22) / 1,55 (2023-26), n=353; entry ACAK dgn exit sama cuma
  PF 1,03 -> p=0,000. `rangerSweep.js`.
  + ✅ **Filter Fear & Greed** (4 Okt): SHORT di-skip kalau F&G < 25 (takut ekstrem = short di dasar, rugi konsisten 2 era n=70
  PF 0,55/0,09). Slot jadi PF 1,87/1,81 (dari 1,45/1,55); ambang 15-35 semua membaik (dataran). Long gak difilter (gak ada pola).
  🔬 Cek ke short Ranger pola chart/FVG (`fngRangerStudy.js`): cuma 7 short 2019-26 (2 pas F&G<25 dua-duanya rugi) -> searah tapi
  n kecil, GAK dipasang. Sampingan: LONG Ranger pas takut ekstrem PF 4,33 (n=10) -- "beli pas orang takut", observasi doang.
- ✅ **Fed Dovish Grid** (FOMC/NFP dovish + tren SMA480, basket layer, LONG) — n=38, win 81,6%, PF 3,03, +163%, DD 27,6%.
  ⚠️ 2022 rugi (PF 0,26) — nyambung ke rezim macro. Demo + real (sejak 3 Okt dua-duanya beneran jalan).
  ℹ️ Cek paritas 5 Okt (`backtest/fedGridLayerTriggerParity.js`): live nambah layer pas harga -2% dari RATA2 posisi, backtest
  dari LAYER TERAKHIR -> live nambah layer lebih cepat. Hasil: live total untung LEBIH GEDE dua era (+55% vs +51% / +60% vs +37%
  modal), tapi SL lebih sering (7 vs 4) & PF era lama 1,69 vs 2,00; rugi per basket tetap dibatasi SL -10% modal. Dibiarin.
- ✅ **Ranger Emas 4H** (MEXC, long doang, real doang — MEXC gak ada demo) — exit 1/2@3R + SMA60, n kecil, dipantau.
  Live TANPA window bull/bear (window SMA1200 lama cuma bikin whipsaw/tutup paksa). Riset window lama (buffer band, ADX,
  RESEARCH-LOG 15 Sep) pakai baseline window yang udah gak live -- jangan dipakai buat banding lagi.
  + ❌ **Donchian (Turtle) sbg window Emas** (4 Okt, `backtest/donchianGoldWindow.js` + `donchianGoldLiveExit.js`) — vs window
  SMA1200 lama memang jauh lebih bagus (PF 0,92 -> 1,37-1,58, dataran 10-40 hari), TAPI vs sistem LIVE (tanpa window, PF 4,29:
  1,85 / 13,2 per era) gerbang Donchian malah NGURANGIN di dua era buat 0/8 panjang N (gerbang doang maupun + tutup paksa).
  Live tetap tanpa window.
- ℹ️ **Paritas trailing SMA60 (5 Okt, `backtest/smaTrailTriggerParity.js`)** — live dulu keluar begitu HARGA LIVE < SMA60, backtest nunggu
  CLOSE candle 4H. Versi live lebih jelek dua era (7 alt PF 2,07/1,61 -> 2,00/1,57; Emas 2,85 -> 2,39 era baru) -> live DISAMAIN ke close
  candle (rangerRotation.js + rangerAutoTrader.js), dijaga selftest rotasi.
- ✅ **Ranger ROTASI 8 koin** (Bybit, 1 posisi pindah2 koin: BTC SOL DOGE TRX INJ ETH XLM BNB) — top-8 CAGR 42% DD 17,9%
  (>=2023) vs BTC doang 19%. Alt long doang, alt /2, short cuma BTC.
- ❌ **Gerbang struktur BOS/CHoCH (SMC)** — semua varian LEBIH JELEK (PF 2,56 -> 1,85-2,09, DD naik ke 62-69%).
- ❌ **Portofolio multi-koin modal dibagi** (22 koin barengan) — >=2023 CAGR cuma 16%; alt jatuh barengan. Diganti rotasi.
- 🔬 **Ranger multi-koin 30 koin per koin independen** — gabungan PF 1,46 (>=2023 PF 1,26), 22 koin terpilih 19/22 positif.
  Dipakai sebagian lewat rotasi; versi banyak-posisi belum (drawdown portofolio belum dicek).
- ❌ **Funding rate BTC sbg konfirmasi Nyopet** — agregat kelihatan naik, tapi split-era & sensitivitas GAGAL (4/7 tahun jelek).
- ❌ **Batas umur gap FVG** — BTC baseline konsisten lebih bagus, emas gagal sensitivitas (cap 360 vs 180) -> reject.
- ⏸️ **Gold twin position** (2 posisi emas: trailing + TP tetap) — dibangun 26 Sep, `enabled:false`.

## 🥷 NINJA (timeframe rendah, BingX) — pelajaran besar: gerak 5M-1H BTC < biaya, hampir semua kalah fee

- ❌ **Channel Breakout 5M** — backtest PF 11 ternyata ARTEFAK fill (entry di level breakout yang udah lewat); entry realistis
  PF 0,36-0,53. Live demo 23 trade: 4 menang, net -$377. Entry dimatikan 30 Sep.
- ❌ **FVG-touch spesifikasi Olan** (5M/15M/1H) — 30 kombinasi semua rugi; terbaik PF 0,98.
- ❌ **Donchian breakout / Turtle Soup / multi-timeframe / momentum intraday (Shen 2022)** — 108 + 40 trial, gak ada yang lolos rigor.
- ❌ **Squeeze breakout 1H** — in-sample PF 1,74 tapi out-of-sample 2019-24 -17,9% (overfit rezim).
- ❌ **CB "dikasih napas"** (trailing lebar) — PF gross OOS 0,85-0,91, rugi bahkan tanpa fee.
- ❌ **"Culik dikit-dikit"** (MR dilonggarin, fade cascade) — 0/136 lolos. Yang untung exchange.
- 🔬 **Ninja Mean Reversion searah tren 15M** (`ninjaMrTrader.js`, demo BingX) — satu2nya yang lolos OOS TAPI cuma kalau fee ~0;
  model eksekusi persis live: OOS PF 0,98 / IS 1,04 = **kira2 impas**. Real OFF ("ragu tinggal").
- ❌ **Ninja MR paper 5M** — dimatikan 3 Okt (arahan: nol paper/manual).
- 🔬 **Ninja Exhaustion** (fade likuidasi "kehabisan tenaga", ide Olan) — backtest ~3 minggu: ambang $300rb RUGI semua exit
  (fade & ikut arah); ambang $800rb ~impas (n=12). Uji DEMO otomatis target 100 transaksi; real kalau PF > 1,2.
- 🔬 **Ninja News DXY** (ide Olan: dolar gerak duluan pas rilis, BTC nyusul kebalikannya) — jadwal CPI/PPI/Retail/NFP/FOMC/
  GDP+PCE Okt-Des 2026 diverifikasi resmi; EURUSDT per detik. **Backtest per detik** (164 rilis 2023-26, `newsDxyLeadStudy.js`):
  arah EUR di 5-10 dtk pertama searah BTC 5 mnt kemudian 63-64%, tapi dibaca dtk 30-60 cuma ~50%. Edge cuma kalau EUR gerak
  >= 0,10% dalam 5-10 dtk: PF 1,14-1,21 (n=27-48, tipis). Selalu lebih bagus dari ikut BTC sendiri. Setting dikalibrasi: jendela
  10 dtk, ambang 0,10%, SL 0,8%, trailing 0,4% aktif +0,6%, maks 30 mnt. Uji demo 1-2 bulan. + Jobless Claims mingguan (Kamis)
  biar cepet keuji: rilis pertama Kamis 8 Okt 20:30 WITA.
  **Event MEDIUM** (5 Okt, `newsMediumStudy.js`, 260 rilis 2023-26, aturan live persis): dolar >= 0,10% dlm 10 dtk cuma ISM 9% /
  Claims 4% rilis. ISM Manufaktur+Jasa 8 trade PF 0,03/0,24 ❌ -> ISM jadi **rekam doang** (`trade:false`, tetap siap-siap +
  laporan 30 mnt). Claims n=7 PF 2,56 tapi paruh2 0,90 -> tetap trade (demo, tipis). Event Medium lain GAK ditambah ke jadwal
  uji (jarang gerakin dolar). Live ISM 5 Okt: dolar 0,018%/mnt, gak entry -- konsisten sama riset.
- ❌ **ICT Sweep di timeframe Ninja (1H / 2H BTC)** (3 Okt) — gak beda dari entry acak (p 0,15-1,0), >=2023 mayoritas rugi.
  Edge sweep CUMA muncul >= 4H (`ict-sweep-ninja-output.log`).
- ❌ **ICT Sweep 4H di ALT** (21 koin, long doang) — gabungan lebih jelek dari acak (p 0,63-1,0); pilih koin pakai <2023 ->
  >=2023 PF 0,65-0,94. Edge sweep KHUSUS BTC (`ict-sweep-alt-output.log`).
- ❌ **ICT Power of 3 intraday** (range Asia -> sapuan London/NY -> distribusi) — 0/144 varian lolos; tanpa fee terbaik PF ~1,1,
  fee 0,05% pun impas. Konsepnya ada jejak tapi terlalu tipis.
- ❌ **CME Gap Fill** (4 Okt, `backtest/cmeGapStudy.js`, 365 gap mingguan 2019-26, biaya 0,12%) — "80% gap ketutup sebelum Jumat"
  memang bener, TAPI itu cuma matematika jarak dekat: win rate tutup-gap malah DI BAWAH peluang random walk (median z -2,3),
  0/120 kombinasi lolos (terbaik PF 0,88/0,78 per era). Arah sebaliknya (ikut gap) juga PF < 1. Mitos, jangan dipakai.
- ⏸️ **Funding Ekstrem (kontrarian, mindset bandar)** (4 Okt, `backtest/fundingExtremeStudy.js`, funding Binance 7.742 settlement
  2019-26, biaya 0,12% + funding ikut dihitung, null permutasi waktu) — SHORT pas funding tertinggi: lemah/gak signifikan.
  LONG pas funding di 2-5% terendah (vs 30-180 hari ke belakang), tahan 24-48 jam: 2020-24 KUAT & berdataran (46/48 kombinasi
  PF > 1, 27/48 p < 0,05 vs kebetulan ~2,4; contoh lb 90h q0,98 H24j PF 1,58 / 2,30). TAPI **2025-26 rugi di 43/48 kombinasi**
  (median PF 0,74) -- edge MATI di rezim terbaru. Filter tren SMA50/100/200 gak nolong (2025-26 malah lebih jelek). Gak dipasang.
  Revisit tiap kuartal (jalanin ulang script, cek apakah 2025-26+ balik positif) -- lihat GANTUNGAN.
- 🔬 **Efek hari: LONG Senin + Rabu 24 jam (08:00 -> 08:00 WITA)** (4 Okt, `backtest/calendarEffectsStudy.js`, pilih di <2023, uji
  di >=2023) — 2 hari terbaik era lama TETAP 2 terbaik era baru (peringkat 1/21 pasangan hari, korelasi efek per hari 0,79),
  Kamis terburuk di dua era. Net +0,31%/trade dua era (PF 1,23 / 1,36, holdout z 2,3), 6/8 tahun positif. TAPI: edge tipis vs
  goyangan harian (DD 42-50% notional), SL darurat 2-4% malah ngerusak era lama, digeser mulai 00:00/04:00 WITA efeknya ilang.
  Gak dipasang: uji demo 100 trade gak bisa ngebuktiin apa2 (galat statistik ~ sebesar efeknya), profil untung/DD kalah jauh dari
  Ranger. Short Kamis (/2) cuma +0,08%/trade di era baru, ~0 di era lama.
- ❌ **Pergantian bulan (turn of the month)** (4 Okt, sama) — era lama kuat (k2 m1 net +2,2%/trade, PF 3,5) tapi era baru KEBALIK
  (net -0,5%, cuma 3/20 varian positif). Overfit/kedaluwarsa klasik.
- ℹ️ **Expiry opsi bulanan Deribit** (Jumat terakhir 16:00 WITA) — 24 jam sebelum expiry BTC lebih kalem dari Jumat biasa di dua era
  (efek "pinning": |gerak| 2,25% vs 2,94% / 1,74% vs 2,04%), tapi arah naik/turun gak konsisten -> gak bisa ditradingin arah.
- ❌ **News 5M "ikut/lawan candle pertama"** (CPI/PPI/NFP/FOMC 2019-26) — 2/160 lolos (FOMC ikut 15m, n kecil). Satu pola
  stabil: JANGAN fade candle 5m pertama CPI (PF 0,29-0,39).

## 📰 NEWS / MAKRO

- ✅ **Scalp FOMC econ-reaction** (ikut reaksi BTC 10 menit pertama, exit paksa 30 menit) — FOMC doang, demo+real.
- ⏸️ **Scalp NFP** — DIPAUSE: permutation p~0,20 + Deflated Sharpe ~0%.
- ❌ **Scalp CPI/PPI** — CPI PF 1,17 gak konsisten per tahun, PPI rugi sebelum fee. Versi long-only juga ditolak.
- ✅ **Filter DXY lemah buat Ranger EMAS** (BTC dicabut 5 Okt, lihat bawah) — lolos split-era + sensitivitas (31 Agu, exit LAMA).
  ⚠️ Cek ulang 4 Okt pakai exit LIVE sekarang (`backtest/dxyLiveExitCheck.js`, mesin 1 slot): BTC trailing 3x -> era lama malah
  lebih jelek pakai DXY (modal x6,80 -> x4,99), era baru ~sama (x3,24 -> x3,31); Emas 1/2@3R -> PF turun dua era tapi modal era
  baru naik, n kecil. Manfaatnya udah GAK JELAS di exit baru. Live BELUM diubah -- antri uji lengkap (2 slot + sweep), lihat GANTUNGAN.
  ❌ **Uji LENGKAP BTC 4 Okt** (`backtest/dxyRangerTwoSlotCheck.js`, 2 slot independen + window halving + trailing 3x = mesin live):
  filter DXY SMA20 MOTONG untung di DUA era (+548% -> +427% / +374% -> +253% modal), SEMUA panjang SMA (10/20/30/50) motong di dua
  era, permutasi DXY palsu p = 0,65 (gak beda dari skip acak). Di exit baru filter DXY BTC = GAGAL rigor. Rekomendasi: cabut buat
  BTC (Emas: hasil campur, n kecil, biarin). **5 Okt Olan setuju -> DICABUT buat BTC** (rangerAutoTrader.js DXY_FILTER_ASSETS = [xau]).

## 🌱 SPOT / JANGKA PANJANG

- ✅ **Musiman DCA BTC (siklus halving)** — walk-forward $500 -> $288.911, CAGR 73,8%, 3 siklus. Demo spot testnet + leg REAL
  (3 Okt, `spotRealLeg.js`) yang cuma belanja dari ANGGARAN KHUSUS `spot-live-config.json realBudgetUsd` (default 0 -- setoran Olan
  yang mampir di Spot gak kemakan).
- ✅ **Compound Alt DCA 10 koin** — 2 siklus: invest $24.948 -> $93.139 (+273%); ZIL rugi -51,7% di siklus 2024. Window tanam
  berikutnya mulai 19 Okt 2026. Leg real sama (anggaran khusus, kepemilikan dicatat `kaela-spot-real-ledger.json`).
- 🔬 **DCA Tangga Leverage BingX Std Futures** ($3/hari x3 -> x5/x7/x9 kalau likuidasi, ide Olan) — dari bottom 2022 +437%,
  TAPI mulai di waktu salah -57% s/d -100%. API cuma baca -> Olan buka manual, Kaela pantau likuidasi (`stdFuturesLadderMonitor.js`).
  Rencana mulai 20 Okt 2026 (akhir window bear). Keputusan Olan 3 Okt: ini jadi jalur DCA real-nya (~Rp50rb/hari x3, saran
  margin >= Rp55rb biar lolos min 0,0001 BTC), gantiin spot DCA real (anggaran spot tetap 0).
  Monitor juga ngingetin TAMBAH COLLATERAL (Std Futures bisa) pas posisi minus >= 50% / 75% margin -> pengingat UMUM "cek posisi" ke grup Wibowo
  Hedgefund (tanpa angka minus/kata likuidasi/sebut collateral, biar anggota gak panik). Likuidasi beneran tetap DM Olan (3 Okt).
  ⏸️ **DIBATALIN 9 Okt 2026** (Olan: ganti strategi grid) -- monitor dimatiin (`std-futures-ladder-config.json enabled:false`).
- 🔬 **Grid "porsi = jarak dari ATH" tanpa leverage** (9 Okt, ide Olan modif prompt grid; `backtest/athDrawdownGrid.js`, spot harian
  2014-2026, fee 0,1%): porsi modal di BTC = dd% dari ATH (step 1%). Varian HOLD_ATH (jual semua pas ATH baru): mulai ATH Des 2017
  x6,25 DD 54% (buy&hold x4,27 DD 83%), mulai ATH Nov 2021 x2,03 DD 41% (B&H x1,21 DD 77%), mulai ATH Okt 2025 x0,98 (B&H x0,65);
  106 titik mulai bulanan: median x3,24 vs B&H x4,06, DD median 41% vs 77%, rugi 3/106 (B&H 11/106). REBALANCE (jual tiap naik 1%)
  gak pernah rugi (0/106) tapi median x2,03. TP20 (jual +20%) paling jelek (median x1,36). Catatan: cuma 3 siklus besar BTC,
  close harian (belum intraday). STATUS: bahan diskusi, BELUM diterapin (Olan: "bahas dulu").
  **Aturan Olan revisi** (TP SEMUA di +15% modal ditanam = target bersih ~10%, ulang LANGSUNG dari acuan ATH, modal siklus = ekuitas):
  106 titik mulai: median x2,10, DD median 42% (terburuk 54%), rugi 5/106, nyangkut tanpa TP terlama 773 hari (bear 2022). TP 10/15/20%
  hasilnya mirip (x2,11/2,10/2,19). Mulai ATH Nov 2021 x1,51 (B&H x1,21); mulai ATH Okt 2025 x0,98 (B&H x0,65), sekarang megang 52% di -3%.
  **+ Leverage** (9 Okt, Olan: "ketahan lama pake leverage, coba 2x"; `backtest/athDrawdownGridLev.js`, Binance futures harian 2017-26,
  funding asli, likuidasi pakai LOW, 94 titik mulai): 1x futures median x1,76 DD 43% nyangkut 755 hr rugi 6/94. 2x ISOLATED per level +
  TP dari posisi yang masih kebuka: median x2,32, nyangkut terlama 442 hr (lebih cepet), rugi 6/94 TAPI DD median 66% terburuk 80%.
  2x NUMPUK 1 posisi (perp biasa, yang bisa otomatis): median x2,34 DD median 78% terburuk 94% (4x hangus semua kalau mulai ATH 2017).
  TP dihitung dari SEMUA modal (termasuk yang kelikuidasi) = nyangkut selamanya abis bear 2018. ISO cuma bisa di BingX Std Futures (manual).

## 🔬 INDIKATOR & DATA (dikumpulin / dipelajari, belum jadi sinyal)

- ❌ **FVG Order Blocks [BigBeluga]** — long ~sama dgn acak, gak ada edge.
- ⏸️ **Smart Money Concepts AI [DefinedEdge]** — "AI"-nya tabel poin tetap; tapi LONG pullback ke FVG searah tren konsisten di atas
  acak 2 era (edge kecil). Belum dipasang terpisah (mirip FVG Ranger yang udah jalan).
- ❌ **Structure Break Volume Profile** — gak konsisten (4H rugi berat di era lama).
- ❌ **Skor "AI" SMC, zona OB, POC structure break** — gak prediktif.
- 🔬 **Radar likuidasi** (burst/imbalance/kering) — WA manual dimatikan 3 Okt; datanya dipakai Ninja Exhaustion.
- 🔬 **Liquidation heatmap, order book wall, cold wallet exchange, whale netflow, miner outflow, smart-money divergence** —
  data numpuk (sebagian cuma bisa mulai sekarang, gak ada histori). Revisit setelah berbulan-bulan.
- ℹ️ **Halving ke-5** — dari tinggi blok: 9-16 Apr 2028 (indikator TradingView bilang 15 Mei, meleset).

## 📚 BELAJAR DARI TOP TRADER (3 Okt 2026, belum di-backtest)

- **Renaissance Medallion** (~66% per tahun sebelum fee, ~39% setelah fee, 1988-2018): ribuan taruhan kecil, menang ~50,75%,
  leverage + biaya eksekusi nyaris nol. Pelajaran buat kita: edge intraday cuma hidup kalau biaya ~0 -> konsisten sama semua
  temuan Ninja. Disiplin ke model, gak pernah ditimpa perasaan.
- **Trend follower besar (Man AHL, Winton, Paul Tudor Jones)**: potong rugi cepat, biarin untung lari, ikut tren menengah
  (= trailing 3x + filter tren kita). Tahun choppy pasti ada; solusinya diversifikasi banyak pasar (= rotasi koin).
- ❌ **Ukuran posisi menurut volatilitas / risiko tetap per trade** (ala CTA/Turtle/PTJ) — diuji 3 Okt (`topTraderPrinciples.js`,
  BTC 4H 2019-26, trailing 3x, DD mark-to-market): Ranger pattern+FVG kalkulator exposure CAGR 74%/61% MAR 1,30/1,49 vs risiko
  tetap 2-5% MAR 0,33-0,35 di era lama. Alasan: kalkulator kita naruh risiko lebih gede di trade SL lebar; trade SL SEMPIT yang
  justru lebih jelek -> sizing volatilitas malah gedein taruhan di trade jelek. (Uji lama 10 Agu di Nyopet versi lama sempat
  nurunin DD 78%->47% -- gak berlaku lagi di sistem trailing sekarang.) **Kalkulator exposure tetap.**
- ❌ **Pyramiding** (nambah unit tiap +1R/+2R, ikut trailing yang sama) — gak konsisten: Ranger pattern bagus >=2023 (MAR 1,49 ->
  1,75-2,34) tapi rusak <2023 (DD 57% -> 65-73%); slot Sweep kebalikannya. Gagal 1 era = ditolak.

## ⏳ NUNGGU OLAN

- **Bitget demo**: key demo tersambung 3 Okt, tapi demo baru (yang bisa API) saldo 0 tanpa tombol isi; saldo 3.000 SUSDT di demo
  lama gak bisa diakses API. Slot ICT Sweep tetap di Binance sampai saldo demo baru Bitget bisa diisi (detail di GANTUNGAN.md).

## 🔧 VALIDASI & FILTER RANGER (3 Okt 2026, `backtest/rangerFilterStudy.js`, 8 koin rotasi 2019-26, exit live)

- ✅ **Lookback pola x6** (rescale dari harian) — x4..x8 semua mirip (8 koin PF 2,13-2,25 / 1,60-1,73), x6 di tengah dataran rata
  = robust, bukan hasil tuning. Tetap.
- ❌ **Filter volatilitas** (persentil ATR14/harga) — gak ada yang membaik di DUA era: skip vol tinggi 2,15->2,74 tapi >=2023
  1,67->1,52; cuma tengah >=2023 turun ke 1,32; cuma vol rendah ~sama tapi trade separuh.
- ❌ **Filter jam** (jam candle sinyal 4H) — gak ada jam yang jelek konsisten: 00 WITA rugi >=2023 (PF 0,75) tapi bagus <2023
  (1,99); 04 WITA lemah dua era (1,13/1,11) tapi tetap positif -> dibuang malah ngurangin untung.

## 🗒️ IDE YANG BELUM DICOBA (dari RESEARCH-LOG)

- ~~Donchian sbg pengganti window bull/bear Emas~~ -- DITES 4 Okt, ditolak (lihat bagian RANGER).
- ~~Fear & Greed sbg konfirmasi~~ -- DITES 4 Okt: berguna CUMA buat blok short sweep pas takut ekstrem (dipasang).
- ~~Real yield (TIPS 10th) buat Emas~~ -- UDAH dicek 15 Sep (RESEARCH-LOG): cocok 2020-22 tapi DECOUPLE 2023-26 (yield naik, Emas +140%, borongan bank sentral) -> gak dipakai.

---

## 🔄 Cara update file ini

Tiap riset/backtest baru (lolos ATAU gagal) -> tambah/ubah 1 baris di bagian yang pas: status + angka kunci + alasan + nama file.
Status berubah (mis. observasi -> dipakai, atau dimatiin) -> ubah tandanya + tanggal. Detail panjang tetap di BACKTEST-REGISTRY.md.
