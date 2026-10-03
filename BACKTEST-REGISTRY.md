# 📊 BACKTEST-REGISTRY.md — Angka Tervalidasi TERAKHIR per Strategi LIVE

Kenapa file ini ada (26 Sep 2026): Olan minta rekap "hasil backtest terakhir sistem yang live",
dan pas ditelusuri ketemu **1 angka yang nyasar** -- 2 file (`backtest/rangerTwinPositionBacktest.js`,
`backtest/rangerTwinPositionWindowGated.js`) nyebut PF 3,71 buat Ranger 4H, tapi log tersimpan
(`backtest/nyopet-latest-full-report-output.log`) nunjukin PF 2,01. Investigasi: log itu STALE
(digenerate 23 Sep, SEBELUM bug resample 4H kepatch di commit `b20fa273` tanggal 25 Sep -- lihat
comment `backtest/rangerChartPatternFvg.js` baris ~34). 3,71 yang BENER (di-generate ulang, cocok
sama kode SEKARANG). Bug resample itu SENDIRI cuma nyentuh file backtest, **live TIDAK kena**
(`rangerAutoTrader.js` pakai candle 4H asli dari Binance, bukan resample).

Akar masalahnya: hasil backtest tersebar di file `.log` lepas-lepas tanpa 1 sumber kebenaran
bertanggal -- gampang basi diam-diam begitu kode diubah tapi log lama gak di-generate ulang. File
ini nutup celah itu: **1 baris = 1 strategi LIVE, angka + file sumber + tanggal + command buat
regenerate**. Update SETIAP kali angka backtest strategi LIVE berubah (parameter baru, bug fix,
atau sekadar refresh data terbaru) -- sama disiplin kayak `BUG_REGISTRY.md`/`SYSTEM-MAP.md`.

## Cara pakai

Kalau mau angka TERBARU (bukan percaya file ini buta-buta kalau tanggalnya udah lama) -- jalanin
ulang command "Regenerate" di kolom masing-masing, itu SATU sumber kebenaran asli. File ini cuma
snapshot + pointer, bukan pengganti jalanin backtest beneran.

## Sniper (BTC, chart-pattern+FVG harian) — `sniperAutoAnalysis.js`

- **Divalidasi**: 13 Sep 2026 (versi window-gated bull=long/bear=short, INI yang LIVE sekarang).
- **Angka**: Profit Factor **2,97**, modal $100 -> **$31.045**, backtest 9 tahun (2017-2026).
  Long 46 trade, short (window-bear) cuma **20 trade** -- sample TIPIS, status "dipantau ketat"
  (bukan final). Short sudah otomatis dapat exposure separuh long (`calculator.js` `hitung()`,
  Aturan Besi #2 SYSTEM-MAP.md) -- proteksi ukuran posisi SUDAH built-in, bukan usulan baru.
- **Sumber**: `web/metodologi-sniper.html:77,202-203`, `sniperAutoAnalysis.js:304-308`.
- **Regenerate**: gak ada script CLI tunggal tersimpan -- angka ini dari riset interaktif 13 Sep
  2026 (lihat histori chat/RESEARCH-LOG.md tanggal itu kalau perlu detail ulang).

## Ranger (dulu "Nyopet") chart-pattern/FVG 4 jam BTC — `rangerAutoTrader.js` (`processAsset`)

- **Divalidasi**: 25 Sep 2026 (patch bug resample 4H, commit `b20fa273`) — REPLACE angka lama.
- **Angka**: n=90 trade, win rate 47,8%, **PF 3,71**, totalR 125,26, modal $100 -> **$2.319**
  (+2.219%), max drawdown 39,9%. Split-era konsisten: Era1 (2018-2020) PF 4,00, Era2 (2021-2025)
  PF 3,34. Data 4H 2017-08-17 s/d 2026-09-23.
- **⚠️ Riwayat**: log lama (`nyopet-latest-full-report-output.log`, sebelum 25 Sep) sempat nunjukin
  PF 2,01/n=252 -- itu STALE (bug resample, lihat penjelasan atas), udah di-regenerate 26 Sep 2026.
- **Sumber**: `backtest/nyopetLatestFullReport.js` (script), `backtest/nyopet-latest-full-report-output.log` (output tersimpan, ter-update 26 Sep 2026).
- **Regenerate**: `node backtest/nyopetLatestFullReport.js`

## Ranger Fed Dovish Grid — `rangerAutoTrader.js` (`detectFedGridSignal`)

- **Divalidasi**: 5 Sep 2026 (`FINAL_RECIPE`, keputusan Olan lewat AskUserQuestion), angka
  di-generate ulang+diarsipkan 26 Sep 2026 (SEBELUMNYA cuma print konsol, gak pernah tersimpan).
- **Angka** (racikan final: agresif 400% total, trigger 2%, hold maks 7 hari, filter SMA480,
  leverage efektif 13x, LONG-only): n=38 trade, win rate **81,6%**, PF **3,03** (gross), return
  compound +163,4%, max drawdown 27,6%. Net-of-fee (estimasi kasar 0,10%/layer): return +143,1%,
  maxDD 29,5%. Split-era: Era1 (<2023) PF 2,38, Era2 (>=2023) PF 14,25 -- TAPI Era2 cuma n=13,
  hati-hati baca PF setinggi itu sbg representatif. Data 15m BTCUSDT 2019-2026, trigger dari FOMC+NFP.
  ⚠️ Tahun 2022 sendiri NEGATIF (PF 0,26, n=4) -- strategi ini gak selalu menang tiap tahun,
  performanya nyambung ke rezim macro (dovish/hawkish cycle), bukan garansi tiap periode.
- **Sumber**: `backtest/fedSignalGridBacktest.js` (script + `FINAL_RECIPE`), `backtest/fed-grid-final-output.log` (output tersimpan, baru 26 Sep 2026).
- **Regenerate**: `node backtest/fedSignalGridBacktest.js` (fetch candle 15m BTCUSDT 2019-2026 via network, ambil ~1-2 menit).

## Musiman DCA (halving cycle, BTC) — `spotDca.js`

- **Divalidasi**: metodologi walk-forward (tiap siklus cuma pakai rata-rata siklus SEBELUMNYA).
- **Angka**: $500 -> **$288.911**, CAGR **73,8%/tahun**, drawdown terealisasi **0%**, 3 siklus
  penuh (2015-2025). TANPA filter apapun by design.
- **Sumber**: `web/metodologi-musiman.html:91-96`.
- **Regenerate**: logic ada di `backtest/halvingWalkForward.js`/`backtest/halvingFullCycle.js` --
  belum ditelusuri detail rumus baris-per-baris pas registry ini dibuat, angka di atas dikutip dari
  metodologi publik yang udah ada, bukan dijalanin ulang.

## Compound Alt DCA (basket 10 koin) — `spotDcaAlt.js` / `spotDcaAltAccount.js`

- **Divalidasi**: BARU 26 Sep 2026 — SEBELUMNYA "LIVE" tanpa angka backtest sama sekali buat
  konfigurasi yang sekarang jalan (basket 10 koin ETH/BNB/XRP/ADA/LTC/DOGE/ZIL/TRX/XLM/SOL,
  kompound PER-KOIN independen, jual di hari ke-536 setelah halving). Backtest LAMA
  (`backtestAltSpotTanamPanen.js`, 25 Agu 2026) buat basket 6-koin+pool-compound yang UDAH GAK
  DIPAKAI -- diganti desain ini 29 Agu 2026, gak pernah di-backtest ulang sampai sekarang.
- **Angka** (script BARU `backtestAltDca10Compound.js`, replikasi PERSIS mekanisme live): 2 siklus
  historis SELESAI (2020 & 2024 -- siklus 2016 di-skip, basket 10-koin belum lengkap listing waktu
  itu). Siklus 2020 (Tanam 2018-11 -> Panen 2021-10): invest $1.260 -> jual **$21.888** (+1.637%).
  Siklus 2024 (Tanam 2022-10 -> Panen 2025-10, modal termasuk compound dari siklus sebelumnya):
  invest $23.688 -> jual **$71.251** (+201%). **Total 2 siklus: invest $24.948 -> jual $93.139
  (+273%)**. ⚠️ TIDAK semua koin untung tiap siklus -- ZIL RUGI -51,7% di siklus 2024 (satu-satunya
  kerugian per-koin yang kejadian), sisanya untung. Window Tanam siklus BERIKUTNYA (2028) baru
  mulai **19 Okt 2026** -- strategi ini LIVE secara kode tapi belum ada satupun entry beneran.
- **Sumber**: `backtestAltDca10Compound.js` (script BARU), `backtest/alt-dca-10-compound-output.log` (output tersimpan).
- **Regenerate**: `node backtestAltDca10Compound.js` (fetch candle harian 10 simbol via network, ~1 menit).

## Ninja / Channel Breakout (BingX) — `ninjaTrader.js`

- **Divalidasi**: 23 Sep 2026 (live mulai), keputusan final "Trailing-only" dikunci 26 Sep 2026
  (versi TP-Tetap DIHENTIKAN, kalah head-to-head).
- ⛔ **KOREKSI FEE 27 Sep 2026 (BUG-KAELATRADE-0045)** -- angka "net-of-fee" lama (Trailing PF 10,82,
  TP-Tetap PF 2,70) SALAH: rumus fee pakai leverage x fee% ("1R = margin penuh"), padahal leverage
  kena cap 50x di 100% trade, jadi 1R cuma ~0,10% harga dan fee round-trip ~**1,15R per trade** (bukan
  0,05R). Angka net yang BENER (`fee-check-output.log`, n=2.696):
  | Fee round-trip | Trailing PF / win (net) | TP-Tetap PF / win (net) |
  |---|---|---|
  | 0 (gross) | 11,70 / 71,4% | 2,98 / 74,9% |
  | 0,04% (~maker+maker) | 6,17 / 64,5% | 1,09 / 69,9% |
  | 0,10% (~taker+taker) | 2,82 / 54,6% | 0,16 / 38,6% |
  | 0,20% (fallback live `FALLBACK_FEE_PERCENT` x2 sisi) | **1,06 / 41,5%** | 0,01 / 9,1% |
  Keputusan Trailing > TP-Tetap TETAP bener (menang di semua level fee), tapi edge-nya SANGAT
  sensitif ke fee asli. Demo live s/d 27 Sep: win 9/20 (45%) -- nyambung ke skenario fee tinggi,
  BUKAN ke 71% gross. Angka gross per-tahun di bawah masih valid SEBAGAI GROSS.
- **Angka** (Trailing, YANG LIVE SEKARANG): n=2.694 trade, win rate **71,4%**, PF **11,68** gross,
  ~~PF 10,82 net-of-fee~~ (salah, lihat koreksi di atas). Data BTCUSDT 5-menit 2 tahun (2024-09-22 s/d 2026-09-22). Konsisten per
  tahun: 2024 PF 11,77 (n=393), 2025 PF 11,15 (n=1.317), 2026 PF 12,39 (n=984).
  Head-to-head vs TP-Tetap (PF 2,99) di 2.411 sinyal yang match persis: Trailing menang 1.612 kali
  vs 579 -> TP-Tetap dihentikan.
  ⚠️ **Bar permutation test GAK signifikan** (p=1,000) -- keputusan tetap lanjut berdasar
  direction-flip test (arah asli win 74,9%/PF 2,99 vs arah dibalik win 21,9%/PF 0,28) yang dianggap
  lebih relevan buat struktur sinyal ini, TAPI ini BUKAN konsensus statistik penuh, dicatat jujur.
  PF 10-11x itu SANGAT tinggi buat strategi frekuensi tinggi -- kalau performa live jauh melenceng
  dari ini (win rate anjlok jauh di bawah 71%, atau PF turun drastis), itu sinyal re-evaluasi, BUKAN
  dianggap varians normal.
- **Sumber**: `backtestNyopetChannelBreakoutFixed2PctCompare.js:1-6`, `fee-check-output.log`, `long-range-output.log`, `direction-flip-longrange-output.log`, `rigor-check-output.log` (semua di root folder).
- **Regenerate**: `node backtestNyopetChannelBreakoutFinalCheck.js` (dan varian lain sesuai nama file, cek comment header masing-masing).

## Ninja FVG + kandidat pengganti Channel Breakout (30 Sep 2026) — `ninjaFvg.js`, `backtestNinjaFvg.js`, `backtestNinjaCandidates.js`

- ⛔ **Backtest Channel Breakout lama TIDAK VALID** (temuan peninjau skeptis 30 Sep 2026): entry diisi
  tepat di level breakout (`top+halfWidth`) walau candle udah kebuka/lari di atasnya. Entry realistis
  -> PF net @0,10% RT: entry=max(open,level) **0,53** (win 29,3%), entry di close candle breakout
  (≈ live) **0,36** (win 21,8%). PF 3,71/11 = artefak fill, BUKAN edge -- cocok sama bar-permutation
  p=1,000 dan histori live. Uji trailing 1m (PF 2,99) juga masih pakai entry teoretis, gak ngebuktiin apa-apa.
- **Histori live demo** (`node ninjaLiveHistoryAudit.js`, 27-30 Sep): 23 trade, 4 menang/19 kalah,
  net -$376,81 (fee 0,10%/sisi), estimasi fee $421 vs gross ~+$44. Entry 10/hari di 28 Sep.
  -> `channel-breakout-config.json` `entryEnabled:false` (30 Sep 2026).
- **FVG-touch sesuai spesifikasi Olan** (1 FVG = 1 entry, 1 posisi aktif, SL = 2x lebar FVG,
  trailing ratchet): **GAGAL** di 5M/15M/1H. 30 kombinasi (minWidth 0,02-0,3% x maxAge) SEMUA net
  negatif @0,10% RT; terbaik 1H w>=0,3% PF net 0,98. PF gross cuma ~1,0-1,2. Sensitivitas SL 1x/3x/4x
  juga gak nolong. Buka-tutup BERHASIL dikurangin (1H: 0% trade <=15 menit, 0,7 trade/hari) tapi
  edge-nya gak ada. `ninja-fvg-output.log`.
- **Kandidat berbukti publik** (entry di OPEN candle berikutnya, SL/trailing k x ATR14, 1 posisi
  aktif): Donchian breakout (Zarattini dkk. 2025) + liquidity sweep/"Turtle Soup" (komponen SMC),
  n=20/50/100, k=2/3/4, filter EMA200 on/off, 5M/15M/1H = 108 trial. Cuma 6 yang net positif
  @0,10% RT, **5M nol**. Terbaik: 1H Donchian-50 ATRx4 PF net 1,13 (tapi 2026 negatif, split
  +39,8/-8,6, perm p=0,23, DSR 0%); 15M sweep-100 ATRx4+EMA200 PF net 1,62 tapi CUMA 35 trade/2
  tahun (1 dari 108 trial, perm p=0,033 wajar muncul kebetulan). **TIDAK ADA yang lolos** rigor.
  `ninja-candidates-output.log`.
- **Riset lanjutan (30 Sep 2026, `backtestNinjaResearch2.js`, `ninja-research2-output.log`)**:
  (1) MULTI-TIMEFRAME (arah 4H EMA50 / Daily SMA50 dari candle yang digabung, entry 15M/1H
  Donchian/sweep/FVG searah) -- 5/40 net positif @0,10% RT, terbaik 1H Daily-SMA50 Donchian-50
  ATRx4 PF net 1,04 (n=148), 2025 negatif hampir di semua sel, 15M SEMUA negatif, DSR 0%, perm
  p=0,12-0,24 -> GAGAL. (2) MOMENTUM INTRADAY (Shen dkk. 2022, prediktor 00:00-00:30 / 13:30-14:00
  / 00:00-23:30 UTC -> posisi 23:30-24:00) -- efeknya GAK ADA di 2024-2026 bahkan SEBELUM fee
  (rata2 gross -0,012 s/d +0,014%/trade, sign-shuffle p>=0,28) -> GAGAL.
  Catatan: di fee maker 0,04% beberapa sel 1H jadi +15-24% net/2 tahun -- lemah, tapi satu-satunya
  arah yang layak kalau riset dilanjut (butuh model fill limit order).
- **Ronde 3 (30 Sep 2026, `backtestNinjaResearch3.js`, `ninja-research3-output.log`)**: mean
  reversion Bollinger 2,5 (fade, +/- filter tren, exit trailing / balik ke SMA20), breakout Donchian
  + konfirmasi volume (+/- jam 13-20 UTC), squeeze breakout (lebar BB di titik terendah). 57 kombinasi
  (kumulatif 235), 4 net positif @0,10% RT. 5M & 15M semua gagal. Satu-satunya yang kelihatan kuat:
  **1H squeeze k=4** PF net 1,74, n=97, positif 2024/2025/2026, perm p=0,02 -- TAPI:
- ⛔ **Uji out-of-sample squeeze 1H GAGAL** (`backtestNinjaSqueezeOos.js`, `ninja-squeeze-oos-output.log`):
  data Sep 2019 - Sep 2024 yang gak dipakai milih parameter -> parameter pemenang PERSIS **-17,9%**
  net (2021 -25,2%, 2022 -45,6%, maxDD 89%). Sensitivitas 27 varian: positif **23/27 in-sample tapi
  cuma 3/27 out-of-sample** = pola yang cuma cocok sama rezim 2024-2026 (overfit/rezim), bukan edge.
  ETH 1H periode 2024-2026 juga negatif (-28/-31%). -> TIDAK dipasang.
- **CB "dikasih napas" (`backtestNinjaCbWide.js`, `ninja-cb-wide-output.log`, PARSIAL 5M)**: sinyal CB
  sama persis, entry realistis, trailing 1x/2x/4x/8x lebar channel, +/- cooldown. Trailing lebar
  berhasil ngilangin "kabur pas ditekan dikit" (ditutup <=15 menit: 89% -> 2%) TAPI PF GROSS
  out-of-sample 2019-2024 cuma 0,85-0,91 di SEMUA lebar -> rugi bahkan TANPA fee. CB 5M gak punya edge.
- **Venue fee 0 + biaya inap (info Olan 30 Sep 2026)** -- `backtestNinjaZeroFee.js`,
  `ninja-zerofee-output.log`: 171 kombinasi (kumulatif 433) diuji ulang dgn 3 skenario biaya inap +
  slippage. H1 (0,5% NOTIONAL tiap lewat 00/08/16 UTC) & H2 (pro-rata): **0/171** positif. H3 (0,5%
  dari MARGIN @50x = 0,01% notional per lewat): 46/171 positif, 7/10 lolos OOS.
- ✅ **KANDIDAT PERTAMA YANG LOLOS: mean reversion searah tren** (`backtestNinjaResearch3.js`
  kind 'mr' trend:true exit 'mean'): close tembus Bollinger(20; 2,5) BERLAWANAN tren EMA200 ->
  masuk balik ke arah tren (buy the dip di atas EMA200 / sell the rip di bawahnya), exit pas close
  balik ke SMA20, SL k x ATR14. Syarat biaya: slippage <=0,01-0,02%/sisi + biaya inap ala H3.
  BTC 15M k=3 @slip 0,01%: in-sample PF 1,28 (+26,7%, n=358, DD 7,2%), **out-of-sample 2019-2024
  PF 1,20 (+68,7%, n=1013, DD 17,5%)**; SEMUA k 1,5/2/2,5/3/4 positif di IS DAN OOS, di 15M DAN 5M
  (`ninja-mr-trend-sensitivity-output.log`); bar-permutation IS p=0,01 (15M) / 0,00 (5M); PSR OOS
  98,5% (15M) / 99,7% (5M); exit di open candle berikutnya hasilnya sama (`ninja-mr-trend-final-output.log`).
  ⚠️ Kelemahan: (1) edge ~0,07-0,1%/trade -- MATI di fee taker exchange biasa (@0,10% RT: -0,9%);
  (2) melemah akhir-akhir ini (15M OOS 2024 -10%, IS 2025 +2%); (3) **ETH gagal** (IS negatif) --
  spesifik BTC; (4) exit trailing MURNI lebih jelek (DD besar, 2025 rugi), TAPI hybrid "TP trailing" (SL diam sampai
  balik ke SMA20, lalu trailing 1x ATR) setara/lebih baik: 15M k=3 IS +27,0% / OOS +99,8% DD 14,9% --
  semua trailK 0,5-2 x k 2-4 x 15M/5M positif IS+OOS (`backtest/ninja/mrTrailingCompare.js`,
  `ninja-mr-trailing-output.log`) -> dipakai di paper (exit 'meanTrail', trailK 1). **Config AKTIF 30 Sep 2026: 5M k=4 trailK=1**
  tanpa fee -- IS +48,5% DD 4,4% [2024 +6, 2025 +26, 2026 +16], OOS +159,4% DD 10,0% [2019 +7, 2020 +27,
  2021 +55, 2022 +31, 2023 +22, 2024 +16] -- satu-satunya varian yang positif di SETIAP tahun dua periode; (5) spread/
  feed harga venue manual belum diketahui. Status: PAPER (`ninjaMrSignal.js`, 30 Sep 2026) -- hitungan
  kertas TANPA fee (keputusan Olan), hasil nyata bakal lebih rendah kalau venue ada spread/biaya inap.
- **Model fee BingX REALISTIS (30 Sep 2026, dasar `ninjaMrTrader.js`)**: entry LIMIT post-only 1 tick di sisi
  baik close (maker 0,02%; sinyal lewat kalau candle berikutnya gak nyentuh -- 7-16% di 15M, ~20% di 5M),
  exit stop/trailing = taker 0,05% (dikejar harga), exit SMA20 via limit ngendap = maker 0,02% (75-83% exit).
  Hasil: **15M k=4 exit SMA20: IS +16% PF 1,16 DD 11% | OOS 2019-2024 +21% PF 1,07 DD 30%** (tahun rugi:
  2019 -3, 2023 -4, 2024 -18/-20, 2025 -4). 15M TP-trailing k=4 trailK=1: IS 0% PF 1,00 | OOS +20% PF 1,06
  -> keunggulan trailing HILANG begitu exit kena taker. 5M semua varian NEGATIF. Jadi eksekutor BingX
  pakai 15M k=4 exit SMA20; paper 5M tanpa fee (`ninjaMrSignal.js`) tetap trailing. Edge TIPIS & 3/8 tahun
  rugi -- TIDAK lolos Aturan Besi #5 versi ketat; Olan tetap minta jalan demo+real (saldo real kecil).
- **Kesimpulan**: di timeframe Ninja (5M-1H) BTC, fee ~0,1% per trade sebanding sama gerak normal --
  belum ada sistem yang lolos. Edge trend-following yang terdokumentasi muncul di timeframe lebih
  tinggi (wilayah Ranger 4H / Sniper Daily). ~~Ninja tetap `entryEnabled:false` sampai Olan mutusin.~~
  **Update 1 Okt 2026**: Channel Breakout (`ninjaTrader.js`) entry MATI; yang LIVE = Mean Reversion 15M k=4
  exit SMA20 (`ninjaMrTrader.js`, `ninja-mr-exec-config.json` enabled+allowReal+entryEnabled true) sejak
  30 Sep ~20:45 WITA. Frekuensi sinyal nyata ~4x/10 hari (dicek 1 Okt: 24 Sep, 26 Sep, 27 Sep, 28 Sep).
- **Konfirmasi independen (sesi lain, 1 Okt 2026)**: backtest FVG-touch terpisah (data 5m 2 thn, 15 config
  spec + 48 varian, split paruh) -> semua config spec RUGI (PF net 0,43-0,93); cuma 2/48 varian lolos
  kedua paruh, marjinal (1H, konfirmasi, trail 4x; paruh-2 PF 1,00-1,07) -- sejalan kesimpulan di atas.
  File-nya (`backtest/ninjaFvgBacktest.js`, duplikat `backtestNinjaFvg.js`) dipindah ke
  `.KAELA-TRASH/2026-10-01/`. Catatan: pesan commit `c42d8d5b` nyebut "+ label TP trailing" -- SALAH,
  diff-nya cuma file backtest itu; label TP beneran dikerjain di `darkKaelaLog.js` `_tpLine` (sesi lain).

## ⚠️ Koreksi model exit Ninja MR + riset "culik dikit-dikit" (1 Okt 2026) — `backtest/ninja/culikResearch.js`, `mrExitModelCompare.js`, `liqBurstEventStudy.js`

- **KOREKSI angka "Model fee BingX REALISTIS" di atas**: angka itu (IS +16% PF 1,16 | OOS +21% PF 1,07)
  ngitung exit SMA20 di harga CLOSE candle + fee maker. Limit ngendap di SMA20 (cara `ninjaMrTrader.js`
  live) ke-fill DI LEVEL SMA20, bukan di close yang udah lewat -> asumsi itu kelebihan ~0,03%/trade.
  Direproduksi (`mrExitModelCompare.js`, data spot 5m 2019-09..2026-09 diagregasi 15m): mode `closeMaker`
  = OOS +23,2% PF 1,06 | IS +13,8% PF 1,14 (cocok registry); mode `strict` (niru live) = **OOS -8,1% PF 0,98
  | IS +3,2% PF 1,04**, per tahun 19:-5 20:+17 21:+8 22:-7 23:-6 24:-10 25:-10 26:+8. Entry taker (open
  candle berikut) = -39,7% / -7,0%. **Ekspektasi jujur Ninja MR live = kira-kira IMPAS setelah fee.**
- **Riset "ambil dikit-dikit" (permintaan Olan)**, 136 kombinasi (kumulatif ~569), model eksekusi niru live
  (limit 1 tick fill kalau ditembus, exit limit SMA20 di levelnya, SL taker+selip), DEV 2019-10..2023-09 /
  HOLDOUT 2023-10..2026-09:
  - A. MR dilonggarin (Bollinger 1,5/2/2,5/3 x TF 5M/15M/30M/1H x tren on/off x SL 3/4 ATR): makin longgar
    = makin sering TAPI makin rugi (5M bb1,5 ~6-20 trade/hari, PF 0,57-0,83). Tanpa filter tren SEMUA rugi.
    Terbaik DEV (1H bb1,5 +tren k3 PF 1,08; 30M bb2 +tren PF 1,08) semua BALIK RUGI di HOLDOUT (PF 0,77-0,80).
  - B. Fade candle "cascade" (rentang >= 2-4 ATR + volume >= 2-5x rata2, close mepet ujung) 5M/15M, exit SMA20
    atau retrace 50%: SEMUA rugi di DEV & HOLDOUT (PF 0,18-0,93).
  - **Lolos (DEV PF>1,1 & HOLDOUT PF>1,05): 0/136.** Gerak normal 5M-1H BTC < biaya round-trip -> "crot
    crot" = yang untung exchange.
- **Studi kejadian likuidasi ASLI** (`liquidation-events.jsonl` Bybit, 17,4 hari, 3.583 event): burst
  >= persentil 95 (>= ~$350rb/5 menit, n=20) -> fade +15m rata2 +0,12% menang 70%; persentil 98 (n=8) +0,26%
  menang 75%. Persentil 80-90 (n=40-80) ~0/negatif. **n terlalu kecil buat bukti** -- arah hipotesis masuk
  akal cuma di ledakan PALING gede. Butuh data berbulan-bulan (listener tetap jalan, data nambah otomatis).

## 🎯 Exit "TP trailing ultimate" + ukuran posisi alt (3 Okt 2026) — `backtest/rangerExitResearch.js`

- **Exit** (entry Ranger tetap, alt LONG doang/short cuma BTC, 15 varian, output `ranger-exit-research-output.log`):
  pemenang KONSISTEN di semua sudut = **partial 33% @2R + SL sisa ke BE + trail SMA60** -- BTC PF 2,72/2,04 vs sekarang
  2,56/1,93 (<2023 / >=2023), 8 koin 2,14/1,63 vs 1,98/1,54, rotasi CAGR 90%/49% vs 78%/42% (DD sama). SMA lebih
  panjang/Chandelier ATR/tanpa partial = menang di 1 era, kalah di era lain -> DITOLAK. Partial 1,5R = paling jelek.
  **DIPASANG** (3 Okt): Ranger Rotasi (`partialFrac` 1/3) + Ranger BTC live (`rangerBtcDualExec.js`, + fix pembulatan qty).
- **Sniper (BTC harian)** (`backtest/sniperExitResearch.js` + run era-split terpisah 2017-22 / 2023-26, engine
  `runFlagBacktestWindowGated` + opsi baru `partialFrac`): partial 1/3 @2R GAK lebih bagus buat Sniper; pemenang 2 era =
  **ambil 1/3 di 3R, trail SMA10** -- 2017-22 CAGR 216% vs 196% (DD 35% sama), 2023-26 CAGR 89% vs 88% DD **36% vs 44%**.
  **DIPASANG** (3 Okt) di Sniper BTC (`sniperAutoAnalysis.js` PARTIAL_RR_BY_ASSET btc:3, `sniperBtcDualExec.js` TP native
  1/3) + fix bug laten untung partial (dikali sisa qty, bukan qty yg ditutup). Emas belum diuji -> tetap 2R/separuh.
- **Ranger EMAS (4H, long doang, tanpa window bear)** (`rangerExitResearch.js` COINS=XAU NOBEAR=1, data PAXG 2020-08..2026-08,
  output `ranger-exit-research-gold-output.log`): pemenang 2 era = **partial 50% @3R, trail SMA60** -- PF <2023 1,23->1,85
  (n 17->13), >=2023 2,88->13,22 (n 23->12, win 52->67%), DD rotasi-sim 32%->4%. **n KECIL** -> DIPASANG (3 Okt,
  `rangerAutoTrader.js` PARTIAL_RR_BY_ASSET xau:3) dgn status DIPANTAU. Porsi 33% gak bantu di emas (tetap 50%).
- **Ukuran posisi** (rotasi 8 koin, exit baru, dari dump trade): ukuran sekarang 2019-22 CAGR 90% **DD 81%** | 2023-26
  CAGR 49% DD 41%. **Alt = exposure /2 (diperlakukan kayak short, ide Olan), BTC long full**: 2019-22 CAGR 84% **DD 55%** |
  2023-26 CAGR 38% DD 37%. Semua separuh: 55%/28% DD 55%/23%. -> **DIPASANG** di rotasi (`hitung(direction:'sell')` buat
  alt & short BTC). Rugi maks 1 trade turun -20% -> -15%. DD = cuma pas posisi ditutup (optimis).
- **🧲 TRAILING ATURAN OLAN** (3 Okt, ide Olan: SL ngikut harga terbaik, jaraknya tetap = N x invalidasi awal, cuma naik,
  tanpa TP tetap). Engine: `rangerExitResearch.js` TRAIL_STUDY=1 (opsi `trailR`) + `runFlagBacktestWindowGated` opsi
  `trailR`/`beAt`. Output: `ranger-olan-trail-output.log`, `ranger-btc-olan-trail-output.log`, `sniper-olan-trail-output.log`,
  `ranger-be-study-output.log`, `sniper-be-study-output.log`.
  - **N=1 (persis contoh Olan) LEBIH JELEK** di semua aset: kena "gocek" kecil terus, DD gak turun. N=2 masih kalah.
  - **N=3 menang di BTC, 2 era**: Ranger BTC 4H PF **3,15/2,87** vs 2,72/2,04 (partial 1/3+SMA60); Sniper harian 2017-22
    CAGR **236%** vs 224%, 2023-26 CAGR **129%** vs 99%, DD **27%** vs 33%.
  - **Alt & emas: trailing kalah** -> tetap exit lama (alt 1/3@2R+BE+SMA60, emas 1/2@3R+SMA60).
  - Early-BE (SL ke entry pas +1,5R): bantu dikit di BTC/Sniper, NGERUSAK emas -> gak dipakai terpisah (ketutup trailing 3x).
  - **DIPASANG** (3 Okt, commit e5a4c790): `sniperBtcDualExec.js` (tanpa TP, SL native Binance dipasang ulang tiap naik
    >=0,1%, dibulatin ke tick 0,1), `rangerBtcDualExec.js` (`trailR` default 3, polling), `rangerRotation.js`
    (`trailRByCoin:{BTC:3}`, SL native Bybit digeser). Selftest rotasi 14/14, regression 100/100.

## 📚 ICT Power of 3 / AMD (Akumulasi-Manipulasi-Distribusi) (3 Okt 2026) — `backtest/ictPo3Study.js`, `backtest/ictSweepHtfStudy.js`

- **Konsep** (dirangkum dari fxopen.com, chartwhisperer.ca, theinnercircletraders.com): akumulasi = range sempit (sesi Asia),
  manipulasi = "Judas swing" nyapu high/low range (ambil stop orang), distribusi = gerak asli ke arah SEBALIKNYA. Entry setelah
  sapuan balik + konfirmasi (close balik ke range / patah struktur CHoCH), SL di ujung sapuan.
- **INTRADAY (wilayah Ninja) -- GAGAL.** BTC 5m 2019-10..2026-09 (2.558 hari), range Asia (NY 20:00-00:00/02:00), sapuan di killzone
  London 02-05 / NY AM 07-10 / gabungan, konfirmasi reclaim/CHoCH, exit TP ujung range / 2R / trailing / tutup 16:00 NY, filter
  bias SMA20 harian / open tengah malam: **0/144 varian lolos** (fee 0,1%). Tanpa fee terbaik cuma PF ~1,1 (CHoCH + bias SMA, tutup
  16:00); fee 0,05% pun impas. Pelajaran: sama kayak semua riset Ninja -- gerak intraday BTC < biaya; konsep PO3 ADA jejaknya
  (tanpa fee positif) tapi terlalu tipis. Output: `ict-po3-output.log`, `ict-po3-nofee-output.log`, `ict-po3-fee005-output.log`.
- **4 JAM / HARIAN (wilayah Ranger/Sniper) -- LOLOS.** "Sweep reversal": candle nyapu low/high N candle sebelumnya lalu close
  balik ke dalam. 384 varian, 40 lolos PF > 1,2 di DUA era. Grid robustness 4H LONG trailing: hampir semua sel swing 20-50 x
  trailing 3x positif dua era. **Pembanding entry ACAK** (risiko & exit sama, 300 simulasi): LONG swing20+tren PF 1,85 vs acak
  median 1,29 (p=0,03); **2 arah swing20+tren SMA300 trailing 3x: PF 1,50 vs acak 1,03 (p=0,000), n=353, 2019-22 PF 1,45 /
  2023-26 PF 1,55.** Harian (Sniper) juga ada yang lolos (swing5 + tren, tahan 5 hari PF 1,81/2,07) tapi n kecil (~150) -- belum
  dipasang. Output: `ict-sweep-htf-output.log`, `ict-sweep-htf-validate-output.log`.
- **1H/2H BTC** (MODE=ninja, `ict-sweep-ninja-output.log`): 16 varian, terbaik 2H swing50 trail2 2arah PF 1,13 (1,27/1,01) p=0,155; 1H
  semua PF 0,79-1,10 & gak beda acak -> GAGAL buat Ninja.
- **4H ALT long** (`backtest/ictSweepAltStudy.js`, `ict-sweep-alt-output.log`, 21 koin histori >=3 thn): PF 0,89-1,04 gabungan, acak
  median 0,98-1,08, p 0,63-1,00; seleksi <2023 -> >=2023 PF 0,65-0,94 -> GAGAL. Edge sweep spesifik BTC.
- **Harian vs entry acak** (MODE=validate1d, `ict-sweep-1d-validate-output.log`): swing5 trail1 PF 1,65 vs acak median 1,18 p=0,033;
  swing5 trail2 p=0,197; swing10 trail1 p=0,123; swing5 trail3 PF 1,18 p=0,460 -> cuma 1 sel lolos, tetangga gagal = GAK ROBUST,
  Sniper gak dikasih slot sweep.
- **DIPASANG** (3 Okt): slot ke-3 Ranger BTC "sweep" (`rangerSweep.js` + `rangerBtcDualExec.js` + `rangerAutoTrader.js`
  `processBtcSweepSlot`), demo+real, aturan SAMA backtest (swing 20, tren SMA300 4H, SL ujung sapuan +/-0,1%, trailing 3x, tanpa DXY,
  gak ikut tutup paksa window halving). Paritas modul live vs backtest: n=342 PF 1,48 (beda ~11 trade di awal data, SMA300 belum
  penuh). Pengaman: skip kalau slot lain kebuka arah sebaliknya (Binance BTCUSDC one-way netting) / Fed Grid pegang simbol.

## 📰 Ninja NEWS dipandu dolar per detik (3 Okt 2026) — `backtest/newsDxyLeadStudy.js`

- Data Binance 1 DETIK EURUSDT (proksi DXY terbalik) + BTCUSDT, 164 rilis CPI/PPI/NFP/FOMC 2023-2026, entry +2 dtk latensi,
  fee+selip 0,12% RT. Output `news-dxy-lead-output.log` (cache data `backtest/.cache-news-1s/`, gitignored).
- **Lead-lag NYATA tapi singkat**: arah EUR di 5 dtk (n=73) / 10 dtk (n=104) pertama searah BTC 5 menit kemudian 63% / 64%;
  dibaca di 30-60 dtk cuma 46-53% (lempar koin). Sinyal dolar SELALU lebih bagus dari 'ikut arah BTC sendiri' (PF 0,3-0,9).
- **Transaksi**: cuma lolos impas+ kalau EUR gerak >= 0,10% dalam 5 dtk (n=27; SL 0,8% trail 0,4% aktif +0,6% maks 30m PF 1,21,
  paruh 0,75/2,62) atau 10 dtk (n=48; PF 1,14, paruh 1,31/1,00). Ambang 0,03-0,06% & jendela 30 dtk = rugi semua.
- **Keputusan**: `ninja-news-config.json` dikalibrasi (jendela 10 dtk, ambang 0,10%, SL 0,8%, trailing 0,4% aktif +0,6%, 30 mnt),
  tetap DEMO (sampel kecil, edge tipis). Real kalau 1-2 bulan demo bagus.

## 🔧 Ranger: lookback, filter volatilitas, filter jam (3 Okt 2026) — `backtest/rangerFilterStudy.js`

- Engine Ranger PERSIS (precomputeSignals/runVariant), 8 koin rotasi live, exit live (BTC trail 3x, alt 1/3@2R+SMA60), fee 0,12%.
  Output `ranger-filter-study-output.log`.
- **Lookback**: x4 PF 2,18/1,73 | x5 2,25/1,67 | **x6 (live) 2,15/1,67** | x7 2,21/1,64 | x8 2,13/1,60 (8 koin <2023/>=2023) -> dataran
  rata, x6 aman. BTC: x4 3,27/3,76, x6 3,15/2,87, x8 2,87/2,70 (n 18-29, terlalu kecil buat ganti).
- **Volatilitas** (persentil ATR14/harga vs 500 candle): skip >80 = 2,74/1,52; skip <20 = 2,08/1,55; tengah 20-80 = 2,81/1,32;
  >50 = 1,78/1,68; <=50 = 3,11/1,65 -> gak ada yang naik di dua era. DITOLAK.
- **Jam candle sinyal**: 00 UTC 2,07/4,32 | 04 1,35/2,87 | 08 5,65/1,12 | 12 1,96/1,04 | 16 1,99/0,75 | 20 1,13/1,11 -> gak ada jam
  jelek konsisten. DITOLAK.

## 😱 Fear & Greed sbg filter slot ICT Sweep (4 Okt 2026) — `backtest/fngFilterStudy.js`

- Trade slot sweep 4H BTC (n=353, trailing 3x) dikelompokin per zona F&G hari entry (alternative.me 2018+). Output `fng-filter-output.log`.
- **SHORT pas takut ekstrem (<25): n=70 PF 0,40 (<2023 0,55 n47 / >=2023 0,09 n23), -35,5R** = short di dasar, rugi konsisten.
  Zona lain short positif (takut 25-44 PF 1,58, netral 2,85). LONG gak ada pola konsisten antar era.
- Sensitivitas "skip short kalau F&G < X": X=15 PF 1,56/1,63 | 20 1,63/1,68 | **25 1,87/1,81 (totR 74,6/89,5 vs 56,8/71,7)** | 30
  1,91/1,82 | 35 2,00/1,88 | 40 1,78/1,88 -> dataran rata, semua membaik dua era. DIPASANG X=25 (`rangerSweep.js passesFngFilter`).

## 🏛️ Prinsip top trader: sizing volatilitas & pyramiding (3 Okt 2026) — `backtest/topTraderPrinciples.js`

- BTC 4H 2019-01..2026-09 (1h resample, `multicoin-cache`), sinyal Ranger pattern+FVG PERSIS (`precomputeSignals`) + slot ICT Sweep,
  exit trailing 3x, fee 0,12%/unit, modal compound $100, DD mark-to-market tiap candle. Output `top-trader-principles-output.log`.
- **Sizing**: kalkulator exposure (sekarang) Ranger CAGR 74%/61% DD 57%/41% MAR 1,30/1,49 (<2023/>=2023); risiko tetap 1/2/3/5%
  MAR 0,33-0,36 / 1,24-1,41. Sweep: exposure MAR 0,59/0,93 vs risiko tetap 0,23-0,29 / 0,60-0,72. -> kalkulator MENANG dua era.
- **Pyramiding** (+1R/+2R, 1-2 unit, 50-100%): Ranger <2023 MAR turun ke 0,98-1,24 (DD 65-73%), >=2023 naik 1,75-2,34; Sweep
  kebalikannya (<2023 naik 0,74-0,88, >=2023 turun 0,44-0,70). Gak konsisten -> DITOLAK.

## 🧪 Ninja EXHAUSTION -- fade likuidasi "kehabisan tenaga" (3 Okt 2026) — `backtest/ninjaExhaustionStudy.js`

- Replay logika radar Jalur C (episode likuidasi 1 sisi >= ambang/30 mnt, kering <= 30% puncak) di `liquidation-events.jsonl` Bybit
  (13 Sep - 3 Okt 2026, 4.209 event), cadence cek 1/5/15 mnt, entry open 1m berikut, fee RT 0,10%, 15 aturan exit (waktu 15m-4j,
  SL/TP tetap, trailing). Output: `ninja-exhaustion-output.log` (fade), `-follow-output.log` (ikut arah), `-bigburst-output.log`.
- **Ambang $300rb (n=30): RUGI di semua aturan exit** (PF 0,2-0,8), fade MAUPUN ikut arah. LONG paling jelek (long-liq kering = harga
  sering lanjut turun). **$800rb (n=12): ~impas** (PF 0,9-1,1; paruh 1 rugi, paruh 2 untung = noise). $1,5jt n=4 gak berarti.
- **Kesimpulan jujur: belum ada edge.** Arahan Olan "uji di demo 100 transaksi" -> DIPASANG demo doang (`ninjaExhaustionTrader.js`,
  ambang $800rb, SL 1% + trailing 0,5% aktif +1%, maks 8 jam -- dipilih dari teori + backtest ~impas, DIKUNCI sebelum uji). Kriteria
  naik real: 100 transaksi demo, PF bersih > 1,2, gak ada 1 paruh pun yang PF < 1.

## 🏹 Upgrade Ranger: gerbang struktur (GAGAL) + portofolio multi-koin -> ROTASI (3 Okt 2026)

- **Gerbang struktur BOS/CHoCH ala SMC** (`backtest/rangerStructureGate.js`, output `ranger-structure-gate-output.log`):
  Ranger 4H cuma entry kalau struktur pivot(L) searah. BTC (engine Ranger 2017-2026): SEMUA varian LEBIH JELEK --
  tanpa gerbang PF 2,56 $100->$2.319 DD 39,9% | L=5 PF 1,85 $1.104 DD 62% | L=10 2,09 $1.550 | L=20 2,03 $966 DD 69% |
  L=30 1,87 $989. 22 koin: PF total naik tipis (1,52 -> 1,55-1,60) TAPI >=2023 TURUN (1,31 -> 1,21-1,26), lebih bagus
  cuma di 11-14/22 koin (= lempar koin). Sinyal bagus yg ditolak bikin slot kosong -> keisi sinyal lebih jelek.
  **DITOLAK.**
- **Portofolio multi-koin modal bersama** (`backtest/rangerMultiCoinPortfolio.js`, output `ranger-multicoin-portfolio-output.log`,
  DD = cuma pas posisi ditutup -> optimis): 22 koin semua slot (0,94 trade/hari) $100 -> $971 (2019-26, CAGR 38%) tapi
  >=2023 cuma CAGR 16%. Modal DIBAGI ke banyak posisi barengan = alt jatuh barengan, hasil turun.
  **Temuan kunci -- ROTASI (1 posisi, modal penuh, pindah2 koin)**, koin dipilih pakai PF <2023 lalu dinilai >=2023:
  top-3 CAGR 33% | top-5 29% | top-8 42% DD 17,9% | top-12 39% -- vs BTC doang 19% DD 17,9%. Konsisten di berbagai N.
- **LIVE DEMO 3 Okt 2026**: `rangerRotation.js` (BingX VST, 8 koin = PF minimum 2 era tertinggi: BTC SOL DOGE TRX INJ
  ETH XLM BNB; FIL dibuang krn gagal >=2023). Detektor = fungsi Ranger live (`detectPatternSignal`/`detectFvgSignal`),
  BUKAN engine backtest -- beda kecil yg sama dgn Ranger BTC live (mis. FVG maks 3% dari gap). Tanpa DXY.
- **Ide kreatif lain yg DITOLAK di studi indikator**: skor "AI" SMC (gak prediktif), zona OB BigBeluga (= acak),
  POC structure break (gak konsisten).

## 🔬 Studi 4 indikator TradingView (3 Okt 2026) — `backtest/indicatorStudy.js`

Kode Pine ASLI diambil (open-source via pine-facade, gak di-commit -- lisensi pembuat), logika ditulis ulang setia
di JS, klaim diuji di BTC 1H & 4H (spot 2019-09..2026-09), return maju searah sinyal - fee 0,12%, dibanding entry
ACAK searah sama, DEV <2023 / HOLD >=2023. Output: `backtest/indicator-study-output.log`.
- **BTC Halving & Supply History (sypherh)**: cuma 6 tanggal hardcode + label reward/supply per era (210rb blok x
  reward, angkanya bener) + hitung mundur. Halving ke-5 diasumsikan 15 Mei 2028 -> MELESET ~1 bln: hitungan dari
  tinggi blok 969.638 (3 Okt 2026, rata2 blok 597-604 dtk) = **9-16 Apr 2028**; `halvingBearWindow.js` (13 Apr) udah bener.
- **FVG Order Blocks [BigBeluga]**: FVG = gap 3-candle > 0,5% harga; "order block" BUKAN candle asli tapi pita
  sintetis [tepi bawah gap - 1x ATR(200), tepi bawah gap]; rusak kalau high candle di bawah pita; sinyal ︽ = low
  candle sebelumnya <= atap pita & low sekarang > atap. Hasil: long ~SAMA/di bawah long acak (4H tahan 42: DEV
  +0,65% vs acak +0,87%, HOLD +0,42% vs +0,87%), short = rugi kayak short acak. **Gak ada edge.**
- **Smart Money Concepts AI [Adaptive] (DefinedEdge)**: "AI"/"Adaptive" = TABEL POIN TETAP (gak ada yg belajar dari
  hasil). Struktur pivot(5) close-break, FVG candle tengah searah, OB = candle lawan terakhir <=30 bar sebelum break,
  sinyal = nyentuh FVG aktif searah struktur & EMA50, konfluens FVG*0,45 + OB*0,35 + 20 (tanpa OB overlap maks 65 ->
  gak pernah ★). Hasil: **LONG di atas long acak di KEDUA era** (1H tahan 96: DEV +0,76% vs acak +0,43%, HOLD +0,85%
  vs +0,43%; 4H tahan 42: +1,30/+1,07 vs +0,87) -- edge kecil tapi konsisten = "beli pullback ke FVG searah tren".
  Short tetap rugi (drift naik BTC). ★ terang (>=70) GAK lebih bagus dari ○ redup (n kecil, bolak-balik). Skor FVG
  tinggi = FVG lebih jarang ketembus (4H: 31% bertahan di skor <40 -> 50% di 85+) TAPI return maju gak naik.
- **Structure Break Volume Profile (erdensedat)**: pivot fraktal 13, CHoCH -> profil volume 50 baris struktur
  sebelumnya -> POC; Ask/Bid cuma PERKIRAAN dari posisi close di candle (bukan order flow asli); kode asli ngitung POC
  cuma di bar terakhir chart (histori sinyal gak keliatan). Hasil (POC dihitung pas CHoCH, non-repaint): 4H DEV rugi
  berat (PF 0,4-0,7), HOLD tipis positif; 1H ~acak. **Gak ada edge yang konsisten.**
- Catatan: banyak perbandingan sekaligus -> beda kecil bisa kebetulan; satu2nya pola konsisten 2 era = SMC AI long.

## 🪜 DCA Futures "Tangga Leverage" $3/hari (ide Olan, riset 1 Okt 2026, BELUM LIVE) — `backtest/dcaLeverLadder.js`

- **Aturan**: tiap hari 1 posisi long BTC perp ISOLATED margin $3 x3; yang kelikuidasi diganti besoknya
  $3 baru dgn leverage naik x5 -> x7 -> x9 (maks), rugi likuidasi tetap dicatat; selesai investasi tunggu
  30 hari lalu panen. Fee taker 0,05%/sisi + FUNDING ASLI Binance (rata2 ~7%/thn notional sejak 2022).
- **Dari bottom 2022 (21 Nov, tau belakangan)**: 1000 hari setor $3.051 -> $16.394 (+437%), rugi liq $51
  (17x x3) | sampai halving setor $1.551 -> $7.416 (+378%), 0 liq. Pembanding x1: +147% / +126%.
  (Tangga ~ sama dgn x3 tanpa ganti di sini, karena hampir gak ada likuidasi kalau mulai di bottom.)
- **Deteksi bottom TANPA ngintip = akhir window bear halving** (`halvingBearWindow.js`, 2022-10-26, ~4 mgg
  sebelum bottom asli, harga $20.068): 1000 hari +467% (liq $51) | sampai halving +396% (0 liq). n=1 siklus
  (data perp baru dari 2019-09) -> BUKAN bukti statistik, cuma 1 contoh.
- **⚠️ Mulai di waktu SALAH = hancur** (start tiap kuartal): mulai 2019-10/2020-01 (1000 hari, nabrak bear
  2022) -60%/-65% dgn rugi likuidasi $10-11rb (tangga x9 terus kena berulang); 500 hari mulai 2021-01 -100%,
  2021-07 -70%, 2025-01 -57%. Tangga leverage MEMPERBESAR rugi di bear market (pengganti x9 dilikuidasi lagi
  dan lagi). Timing start = SEGALANYA.
- **Kendala eksekusi BingX**: perp NGEGABUNG semua long 1 simbol jadi 1 posisi (1 leverage, 1 harga
  likuidasi) -> "tiap posisi independen" WAJIB disimulasi software (layer virtual + tutup reduce-only per
  layer pas sentuh harga likuidasi virtualnya), bukan isolated asli. Min qty BTC 0,0001 (~$8,4 di $84rb)
  -> $3 x3 = $9 notional cukup selama BTC < ~$90rb; di atas itu perlu setoran 2 hari sekali / margin naik.
  Standard Futures BingX: API cuma BACA (gak bisa order).
- **Calon start nyata berikutnya**: window bear sekarang berakhir **2026-10-20** -> sampai halving ~Apr 2028.

## 📰 Ninja di jam NEWS (riset 1 Okt 2026) — `backtest/ninja/newsWindowStudy.js`

- 305 event 2019-2026 (CPI 83, PPI 82, NFP 84, FOMC 56), data 5m spot. Gerak 15 menit pertama vs jam sama
  minggu lalu: CPI x3,5 (0,89%), FOMC x3,2 (0,72%), NFP x1,7, PPI x1,3 -- volatilitas BENERAN naik.
- Strategi tanpa nebak angka: ikut/lawan arah candle pertama (5m/15m), tahan 30-240 mnt, +/- SL, fee 0,12% RT.
  **Lolos (rata2 net > +0,05% di DEV <2023 DAN HOLD >=2023): 2/160** -- dua2nya FOMC "ikut arah candle 15m
  pertama, tahan 4 jam" (tanpa SL: DEV PF 1,23 n=26 | HOLD PF 3,94 n=30). n kecil + 160 kombinasi -> bisa
  kebetulan; FOMC juga UDAH dimanfaatin Ranger Fed Dovish Grid. CPI bolak-balik (gak konsisten antar era),
  satu-satunya pola stabil: FADE candle 5m pertama CPI = rugi konsisten (PF 0,29-0,39) -> jangan lawan
  gerakan pertama CPI. Kesimpulan: news = volatil, tapi ARAH-nya gak bisa ditebak dari harga doang.

## 🌐 Ranger 4H MULTI-KOIN (riset 1 Okt 2026, BELUM LIVE) — `backtest/rangerMultiCoin.js`

- **Latar**: Olan minta "sehari minimal 1 momen culik". Timeframe rendah terbukti kalah fee (bagian atas),
  jadi frekuensi dinaikin lewat LEBAR (banyak koin), bukan lewat timeframe rendah.
- **Metode**: engine Ranger live PERSIS (`runNyopetV2BacktestWindowGated` + `RESCALED_4H`, modal/5,
  window halving BTC berbasis tanggal) di 30 koin, candle 1j spot Binance 2019-01 -> 2026-10 diresample
  4H. Engine asli GAK ngitung fee -> tiap trade dipotong 0,12% notional (taker+selip). Metrik = % notional
  net fee per trade. Posisi per koin independen (BELUM simulasi portofolio/korelasi/modal bareng).
- **Sanity**: BTC n=76 PF 2,46 net (<2023 2,62 | >=2023 2,21) -- sejalan registry Ranger (PF 3,71 itu satuan R, tanpa fee).
- **Gabungan 30 koin**: n=2.924, win 38%, PF 1,46 | <2023 PF 1,76 (n=1.190) | >=2023 PF 1,26 (n=1.734) ->
  **1,27 sinyal/hari sejak 2023**.
- **Seleksi JUJUR (pilih pakai <2023 doang: PF>1,2 & n>=8)** = 22 koin (BTC ETH BNB SOL XRP DOGE ADA AVAX
  LINK DOT LTC BCH TRX ATOM NEAR UNI ETC FIL INJ AAVE XLM HBAR) -> hasil >=2023 (gak dipakai milih):
  n=1.242 (~0,9/hari), total +2.246% notional (~+1,8%/trade), 19/22 koin positif (rugi: NEAR -28%,
  UNI -26%, FIL -62%).
- **Koin baru (listing >=2023) jelek**: OP PF 0,90, SUI 0,90, WIF 0,83, ARB/TIA ~1,0 (PEPE 1,82 pengecualian)
  -> aturan kandidat: cuma koin yang punya histori >= 3 thn.
- **⚠️ Belum dicek**: drawdown PORTOFOLIO (alt korelasi tinggi ke BTC -> rugi barengan), jumlah posisi
  bareng maksimum & kebutuhan modal, ketersediaan pair + min notional di BingX. Hold per trade berhari-hari
  (trail SMA60 4H) -- "1 sinyal/hari" = frekuensi ENTRY, bukan profit tiap hari. Win rate ~38% (banyak rugi
  kecil, sedikit untung besar).
- **Regenerate**: `node backtest/rangerMultiCoin.js [cacheDir]` (download ~30 koin 1j, total ~20-30 menit),
  output tersimpan `backtest/ranger-multicoin-output.log`.

## 🔄 Cara Update File Ini

Sama ritual kayak `BUG_REGISTRY.md`/`SYSTEM-MAP.md` -- update SETELAH approve perubahan besar
(parameter strategi baru, bug fix backtest, atau sekadar refresh data pas ada strategi baru masuk
LIVE). **JANGAN** biarin baris di sini nyimpang dari kode SEKARANG kayak insiden 3,71-vs-2,01 --
kalau ubah parameter yang mempengaruhi angka di sini, regenerate ULANG pakai command yang tercantum
sebelum commit, JANGAN cuma edit angka manual.
