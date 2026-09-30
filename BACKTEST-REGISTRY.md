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
