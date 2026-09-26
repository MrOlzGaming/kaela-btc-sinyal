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
- **Angka** (Trailing, YANG LIVE SEKARANG): n=2.694 trade, win rate **71,4%**, PF **11,68** gross,
  PF **10,82** net-of-fee. Data BTCUSDT 5-menit 2 tahun (2024-09-22 s/d 2026-09-22). Konsisten per
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

## 🔄 Cara Update File Ini

Sama ritual kayak `BUG_REGISTRY.md`/`SYSTEM-MAP.md` -- update SETELAH approve perubahan besar
(parameter strategi baru, bug fix backtest, atau sekadar refresh data pas ada strategi baru masuk
LIVE). **JANGAN** biarin baris di sini nyimpang dari kode SEKARANG kayak insiden 3,71-vs-2,01 --
kalau ubah parameter yang mempengaruhi angka di sini, regenerate ULANG pakai command yang tercantum
sebelum commit, JANGAN cuma edit angka manual.
