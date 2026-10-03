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
  p=0,025) = bukti terkuat dari semua strategi live. Filter DXY (lolos rigor). Demo+real (`rangerBtcDualExec.js`), trailing 3x.
- ✅ **Ranger slot ke-3: ICT liquidity sweep 4H** (3 Okt) — candle nyapu low/high 20 candle lalu close balik, searah tren
  SMA300, SL ujung sapuan, trailing 3x. 2 arah PF 1,45 (2019-22) / 1,55 (2023-26), n=353; entry ACAK dgn exit sama cuma
  PF 1,03 -> p=0,000. `rangerSweep.js`.
- ✅ **Fed Dovish Grid** (FOMC/NFP dovish + tren SMA480, basket layer, LONG) — n=38, win 81,6%, PF 3,03, +163%, DD 27,6%.
  ⚠️ 2022 rugi (PF 0,26) — nyambung ke rezim macro. Demo + real (sejak 3 Okt dua-duanya beneran jalan).
- ✅ **Ranger Emas 4H** (MEXC, long doang, real doang — MEXC gak ada demo) — exit 1/2@3R + SMA60, n kecil, dipantau.
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
  10 dtk, ambang 0,10%, SL 0,8%, trailing 0,4% aktif +0,6%, maks 30 mnt. Uji demo 1-2 bulan, rilis pertama CPI 14 Okt 20:30 WITA.
- ❌ **ICT Power of 3 intraday** (range Asia -> sapuan London/NY -> distribusi) — 0/144 varian lolos; tanpa fee terbaik PF ~1,1,
  fee 0,05% pun impas. Konsepnya ada jejak tapi terlalu tipis.
- ❌ **News 5M "ikut/lawan candle pertama"** (CPI/PPI/NFP/FOMC 2019-26) — 2/160 lolos (FOMC ikut 15m, n kecil). Satu pola
  stabil: JANGAN fade candle 5m pertama CPI (PF 0,29-0,39).

## 📰 NEWS / MAKRO

- ✅ **Scalp FOMC econ-reaction** (ikut reaksi BTC 10 menit pertama, exit paksa 30 menit) — FOMC doang, demo+real.
- ⏸️ **Scalp NFP** — DIPAUSE: permutation p~0,20 + Deflated Sharpe ~0%.
- ❌ **Scalp CPI/PPI** — CPI PF 1,17 gak konsisten per tahun, PPI rugi sebelum fee. Versi long-only juga ditolak.
- ✅ **Filter DXY lemah buat Ranger** — lolos split-era + sensitivitas.

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
  Monitor juga ngingetin TAMBAH COLLATERAL (Std Futures bisa) pas posisi minus >= 50% / 75% margin + saran nominal (3 Okt).

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

- Donchian sbg pengganti window bull/bear Emas.
- Fear & Greed / real yield sbg konfirmasi.

---

## 🔄 Cara update file ini

Tiap riset/backtest baru (lolos ATAU gagal) -> tambah/ubah 1 baris di bagian yang pas: status + angka kunci + alasan + nama file.
Status berubah (mis. observasi -> dipakai, atau dimatiin) -> ubah tandanya + tanggal. Detail panjang tetap di BACKTEST-REGISTRY.md.
