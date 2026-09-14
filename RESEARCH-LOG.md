# Riset Otomatis Kaela BTC Sinyal

File ini adalah memori riset yang bisa diakses baik oleh Kaela lokal (sesi Claude Code di
komputer Olan) maupun Kaela cloud researcher (routine terjadwal harian). Tujuannya: supaya
riset baru gak ngulang-ulang ide yang udah kebukti gagal, dan Olan bisa lihat histori
lengkapnya di satu tempat.

## ⛔ ATURAN BAKU (WAJIB dipatuhi tiap riset, gak boleh dilonggarkan)

1. **Breakdown per tahun WAJIB** — jangan cuma lihat angka agregat, cek tiap tahun individual.
2. **Validasi split-era** — bagi data historis jadi 2 era independen (misal 2020-2022 vs
   2023-2025), efeknya harus REGAH bertahan di KEDUANYA (atau minimal gak merugikan), bukan
   cuma nangkring bagus di salah satu era.
3. **Tes sensitivitas parameter** — coba nilai parameter di sekitarnya (misal SMA20 → coba
   SMA10/SMA50 juga). Kalau efeknya runtuh/hilang cuma gara-gara geser parameter dikit, itu
   TANDA overfitting, bukan edge asli.
4. Kalau SALAH SATU dari 3 checklist di atas gagal → **JANGAN dianggap edge asli**, walau
   angka agregatnya kelihatan bagus. Laporkan sebagai "temuan negatif/gak cukup kuat", bukan
   fitur baru.
5. **JANGAN PERNAH menerapkan temuan ke sistem LIVE tanpa persetujuan eksplisit Olan.**
   Riset ini murni eksplorasi + laporan jujur. Implementasi nunggu Olan bilang "ya, pasang".
6. Kalau ternyata sinyalnya melibatkan kirim WA ke Olan atau member — **JANGAN kirim
   langsung dari sesi cloud** (gak ada akses `secrets.js`/Fonnte di sana). Cukup tulis laporan
   di bagian "Temuan Terbaru" di bawah; sesi Kaela lokal yang nanti relay ke WA.
7. **(31 Agu 2026, ide Olan "boleh clone Kaela, diskusi bareng") Review wajib oleh sub-agent
   skeptis** — sebelum nulis kesimpulan final, spawn SATU sub-agent (tool Agent,
   general-purpose) berperan "Kaela — Peninjau Skeptis". Kasih dia angka mentah TANPA kasih
   tau kesimpulanmu duluan (hindari bias), minta dia periksa ulang dari nol apa 3 syarat rigor
   di atas BENERAN lolos. Kalau dia nemu kelemahan yang kelewat, WAJIB dicatat + default ke
   kesimpulan lebih konservatif kalau kalian gak sepakat.

## Format tiap entri baru (tambahkan di atas, paling baru paling atas)

```
### [TANGGAL] — [Nama ide riset]
**Ide:** deskripsi singkat apa yang diuji dan kenapa (motivasi/hipotesis)
**Metode:** parameter/data yang dipakai
**Hasil breakdown per tahun:** ringkas
**Split-era:** LULUS / GAGAL (+ kenapa)
**Sensitivitas parameter:** LULUS / GAGAL (+ kenapa)
**Kesimpulan:** EDGE ASLI (rekomendasi terapkan, tunggu approval Olan) / TIDAK CUKUP KUAT
  (overfitting-like, jangan diterapkan) / masih belum konklusif
**Status implementasi:** belum diterapkan (default) — hanya berubah kalau Olan approve
```

---

## Temuan Terbaru (paling baru di atas)

### 2026-09-15 — Matangkan strategi Emas short: whipsaw window ketemu+fix SEBAGIAN, TAPI belum siap real
**Ide:** Olan minta "matangkan strategi emas short" (kelanjutan dari izin short 14 Sep, Emas
sengaja belum diaktifin karena backtest awal lebih jelek dari BTC). Diagnosis dulu SEBELUM nyoba
fix: hitung persis seberapa parah masalahnya.

**Diagnosis ketemu akar masalah jelas**: window bull/bear Emas (SMA1200-4H, ≈SMA200-harian,
crossover POLOS) bikin **348 dari 444 trade Nyopet Emas (78%!) kena tutup paksa WINDOW_FLIP**,
rata2 posisi cuma idup **2,89 hari** sebelum di-chop -- window-nya SENDIRI yang kelewat gugupan
(whipsaw di sekitar garis rata-rata), BUKAN pola entry-nya yang salah.

**Metode**: `backtest/goldWindowMaturation.js` -- coba 2 pendekatan fix: (A) SMA lebih panjang
polos (1800/2400 4H) -- INTUISI SALAH, whipsaw TETAP tinggi (66-72%, SMA panjang cuma bikin garis
lebih lambat, tetap disenggol terus). (B) **Buffer band gaya "Schmitt trigger"** (standar industri
buat ngilangin whipsaw) -- window CUMA ganti kalau harga nembus JAUH dari SMA (>bufferPct%), TETAP
di state lama selama harga di "zona netral" -- dites 4 level (2/5/8/12%).

**Hasil Buffer band**: whipsaw TURUN DRASTIS & konsisten di semua level (21/7/3/1 dari ~100 trade,
vs 348/444 baseline) -- ini fix yang BENERAN JALAN secara mekanis. Win rate JUGA naik konsisten
16,4%→~42% di SEMUA level buffer. TAPI:
- **Split-era GAGAL** -- Era1 (2020-2023) PF masih DI BAWAH 1 (rugi bersih) di baseline MAUPUN
  keempat level buffer (0,91/0,40/0,63/0,75) -- gak pernah tembus untung di era itu. Semua profit
  numpuk di Era2 (2023-2026, kebetulan bull run Gold besar).
- **maxDD gak monoton** antar level buffer (19,0%→36,8%→37,6%→22,3%) -- bukan tanda whipsaw-fix-nya
  palsu, tapi tanda jangan pilih level cuma dari 1 angka maxDD spesifik (path-dependent, sample
  size ~100/level masih rawan noise di metrik itu).

**Review sub-agent (Peninjau Skeptis)**: dikasih angka mentah TANPA kesimpulan -- verdict
**"sukses parsial genuine, TAPI belum layak modal real"**: whipsaw fix-nya bersih & mekanis solid,
TAPI Era1 gagal PF>1 di SEMUA konfigurasi berarti edge short/long Emas ini belum terbukti robust
lintas rezim pasar -- baru kebukti profitable di 1 era bull yang dominan. Rekomendasi: pakai buffer
12% (atau 2%, hindari 5%/8% -- kombinasi terburuk maxDD tinggi + Era1 paling negatif) buat
**lanjut demo/paper trading DOANG**, cari tau kenapa Era1 selalu rugi (COVID crash/rezim beda
total, atau emang gak ada edge chart-pattern/FVG di luar bull run) SEBELUM buka short real Emas.

**Kesimpulan**: **BELUM SIAP buat uang real.** Whipsaw (masalah EKSEKUSI) berhasil diperbaiki
signifikan, tapi itu BUKAN bukti edge trading-nya (masalah STRATEGI) udah robust -- 2 hal beda
yang gampang ketuker. Emas short TETAP di jalur info-only (sesuai keputusan Olan 14 Sep), buffer
band BELUM diterapkan ke live manapun -- ini murni riset, nunggu investigasi lanjutan soal Era1
sebelum dipertimbangkan lagi.
**Status implementasi:** TIDAK diterapkan. `makeBufferedBearWindowFn` (backtest/goldWindowMaturation.js)
cuma alat riset, belum dipakai kode live manapun.

---

### 2026-09-14 — Validasi aturan "short exposure = separuh long" (BTC+Emas, Sniper+Nyopet, 2020-2026)
**Ide:** Olan minta backtest ulang aturan baru live malam ini (short SEKARANG separuh exposure long,
lihat [[project-kaela-btc-sinyal]]) SEBELUM dipercaya buat uang real -- "kita backtest dari tahun
dekat aja 2020", semua kombinasi: Sniper BTC, Sniper Emas, Nyopet BTC, Nyopet Emas.

**Metode:** `backtest/shortHalfExposureValidation.js` -- bandingin LAMA (short = exposure SAMA
kayak long) vs BARU (short = separuh) di window-gated engine yang SAMA PERSIS dipakai live
(`runFlagBacktestWindowGated`/`runNyopetV2BacktestWindowGated`), per-tahun + split-era, data
2020-2026.

**Hasil awal bikin kaget**: Sniper BTC BARU JAUH lebih jelek dari LAMA (final $4.697 vs $15.770,
maxDD 46,3% vs 24,0%) -- padahal short-nya SECARA INDIVIDUAL lebih kecil/aman. Sniper Emas, Nyopet
BTC, Nyopet Emas SEMUA aman (statistik R-multiple nyaris/persis identik, maxDD malah TURUN di
beberapa kombinasi).

**Review sub-agent (Peninjau Skeptis)**: dikasih angka mentah TANPA kesimpulan -- nemuin pola
kunci: statistik R-multiple (winRate/PF/totalR) SECARA MATEMATIS gak sensitif ke perubahan sizing
murni (rMultiple = rasio harga vs risiko, bukan fungsi dari nilai posisi) -- KECUALI kalau sizing
lebih kecil bikin trade tambahan LOLOS gerbang `margin > capital` yang sebelumnya kegagalan.
Verdict: 3 dari 4 kombinasi AMAN (gerbang cuma sempat kena dikit terus balik sinkron), TAPI Sniper
BTC butuh investigasi lebih dalam -- curiga modal awal backtest ($100, sengaja kecil) bikin gerbang
margin KELEWAT sensitif, gak representatif buat modal real yang beneran dipakai Olan nanti.

**Investigasi lanjutan (dites LANGSUNG, bukan asumsi)**: jalanin ulang Sniper BTC LAMA vs BARU di
4 skala modal awal ($100/$1.000/$5.000/$20.000), topUpAmount dimatiin biar bersih (isolasi murni
efek modal awal). Hasil: di $100 trade count LAMA vs BARU beda jauh (38 vs 46) -- TAPI begitu
modal awal $5.000+ (realistis buat modal real), trade count JADI IDENTIK (48 vs 48, maxDD 35,2%
vs 35,2% SAMA PERSIS) -- final capital beda tipis (LAMA $33.217 vs BARU $30.394, ~8,5% lebih
kecil di BARU) TAPI itu emang ongkos wajar dari "short lebih kecil", BUKAN resiko tersembunyi.
**Kesimpulan: kekhawatiran awal itu ARTEFAK modal awal $100 yang gak realistis, BUKAN bahaya
beneran** -- di modal yang beneran relevan, aturan baru ini aman, cuma bikin sedikit lebih
konservatif (final ~8-17% lebih kecil tergantung skala, maxDD SAMA).

**Kesimpulan final**: **AMAN buat live** -- semua 4 kombinasi (BTC+Emas, Sniper+Nyopet) TIDAK
nunjukin resiko baru dari aturan "short = separuh exposure" di modal REALISTIS. Aturan ini murni
bikin lebih konservatif (biaya kecil di potensi profit short, gak ada bahaya tersembunyi).
**Catatan penting metodologi**: backtest window-gated project ini SELALU pakai modal awal kecil
($100) buat konsistensi lintas riset -- ketauan malam ini itu BISA menyesatkan buat pertanyaan
yang sensitif ke skala modal (kayak interaksi gerbang margin). Kalau riset masa depan nanya soal
efek sizing/margin-gating, WAJIB dites di beberapa skala modal, JANGAN cuma $100.
**Status implementasi:** SUDAH LIVE (aturan diimplementasi sebelum backtest ini, atas keputusan
Olan) -- backtest ini KONFIRMASI RETROAKTIF, bukan gerbang sebelum deploy. Gak ada perubahan kode
lebih lanjut yang diperlukan.

---

### 2026-09-14 — Funding Rate BTC sebagai konfirmasi entry, Nyopet BTC (dari daftar "Ide belum dicoba")
**Ide:** skip entry LONG Nyopet kalau funding rate BTC perpetual lagi DI ATAS rata-rata dirinya
sendiri (SMA-nya sendiri, filter self-referential -- SAMA pola `dxyFilter.js` yang terbukti
valid buat DXY, biar gak overfit ke angka ambang absolut). Hipotesis: funding tinggi = posisi
long lagi crowded/mahal ditahan, sinyal resiko reversal/squeeze lebih tinggi, kurang ideal buat
nambah long baru.

**Metode:** `backtest/refreshFundingCache.js` (fetch histori funding rate BTCUSDT penuh dari
Binance Futures, 2019-2026, 7682 entri) + `backtest/fundingFilter.js` (lookup `isFundingFavorable`,
funding close < SMA-nya sendiri, no look-ahead) + `fundingFilter` param baru di
`nyopetChartPatternFvg.js` (`runNyopetV2Backtest`, opsional/backward-compatible, pola PERSIS
`dxyFilter`) + `backtest/fundingNyopetScrutiny.js`. BTC DOANG (funding rate Emas/PAXG MEXC belum
ada histori/dicoba di project ini). Data 2020-2026 (startMs seragam), SMA20 funding (~6,7 hari)
sbg default, sensitivitas SMA10/50.

**Hasil breakdown per tahun:** Aggregate kelihatan lebih baik (baseline PF=1.48 n=163 final=$1012
vs +filter PF=1.56 n=145 final=$1267), TAPI per tahun 4 dari 7 tahun (2020/2021/2023/2024) justru
totalR-nya LEBIH JELEK pakai filter, cuma 2022 (tahun crash) yang nyumbang perbaikan besar
(+8.52 totalR). **Temuan paling telak** (ketemu pas review sub-agent): jumlah TOTAL totalR
aggregate baseline (48.29) vs filtered (48.43) HAMPIR IDENTIK (selisih 0.14, noise) -- padahal
final capital beda jauh ($1012 vs $1267). Artinya kenaikan capital itu BUKAN dari edge statistik
R-multiple beneran, tapi efek reshuffle urutan trade (nolak 1 entry di 1 titik menggeser slot
kapan posisi berikutnya kebuka, backtest engine ini emang begitu sifatnya).

**Split-era:** **GAGAL.** Era1 (2020-2023): PF baseline 1.08 -> +filter 1.07 (TURUN, bukan
flat/naik). Era2 (2023-2026): PF 1.86 -> 2.13 (naik jelas). Syarat "harus hold di KEDUA era"
gak lolos -- seluruh efek positif numpuk di Era2 doang.

**Sensitivitas parameter:** **GAGAL.** SMA10: PF=1.45 (DI BAWAH baseline 1.48 -- parameter
tetangga terdekat malah lebih jelek dari TANPA filter sama sekali). SMA20: PF=1.56, final
tertinggi $1267. SMA50: PF=1.61 (PF tertinggi) tapi final cuma $1065 (hampir sama baseline). PF
dan final capital gak bergerak searah antar parameter -- gak ada tren monoton yang masuk akal,
rapuh/fragile khas overfitting ke 1 titik parameter (SMA20) yang kebetulan paling bagus.

**Review sub-agent (Peninjau Skeptis):** independen dikasih angka mentah TANPA kesimpulan --
verdict REJECT ("TIDAK CUKUP KUAT — bukan edge asli, jangan diimplementasikan"), ketemu insight
tambahan (totalR aggregate nyaris identik) yang bahkan lebih telak dari analisaku sendiri.
Sepakat penuh.

**Kesimpulan:** **TIDAK CUKUP KUAT / overfitting-like.** Ketiga syarat rigor GAGAL (bukan cuma
salah satu) -- per-tahun gak konsisten, split-era cuma menang di 1 era, sensitivitas parameter
rapuh (SMA10 kalah dari tanpa-filter). Kenaikan angka aggregate yang kelihatan bagus di
permukaan ternyata artefak reshuffle urutan trade + overfit ke era 2023-2026 + overfit ke SMA20,
bukan edge funding rate beneran.
**Status implementasi:** TIDAK diterapkan. Live tetap tanpa filter funding rate.

---

### 2026-08-31 — Batas umur gap FVG buat Nyopet v2 (ide dari observasi live Olan)
**Ide:** Nyopet v2 numpang PERSIS mesin deteksi FVG yang sama kayak Sniper (`fvgDetector.js`) --
nyisir mundur ke gap TERTUA yang belum keisi TANPA batas umur (cuma dibatasin total candle yang
di-fetch, ~10 bulan buat 4H). Window lookback pola grafik (flag/wedge) UDAH di-rescale ×6 sepadan
4H, tapi FVG-nya kelewat. Olan nemuin posisi Nyopet BTC live (31 Agu) nyawa-nya 20,66% (di atas
p99 historis 18,89%) -- diduga gara-gara gap tua yang baru kesentuh sekarang, itu lebih gaya
SNIPER (sabar, struktur lama valid) drpd gaya Nyopet (cepat, struktur baru). Hipotesis: batasin
umur gap (candle 4H) bikin Nyopet lebih "konsisten" sama identitasnya DAN mungkin ningkatin PF.
**Metode:** `backtest/nyopetFvgGapAgeCap.js` (salinan engine Nyopet v2, TIDAK nyentuh live code)
+ param baru `maxGapAgeCandles`. Diuji BASELINE (gak dibatasin) vs cap=360 candle (~60 hari) vs
cap=180 candle (~30 hari), BTC & Emas, data 3 tahun terakhir (2023-09 s/d 2026-08, dipersingkat
dari histori penuh 9 tahun murni krn keterbatasan waktu compute -- backtest full-history makan
~90 detik/config, gak feasible ngejalanin banyak kombinasi sekaligus dalam sesi ini).
**Hasil breakdown per tahun:** BTC ADA (2023-2026, lihat commit). **Emas TIDAK dibuat** --
kelemahan proses riset ini sendiri, ketauan pas review sub-agent (lihat bawah).
**Split-era:** **GAGAL buat BTC** -- baseline (PF 1,96/1,39 di 2 era) KONSISTEN LEBIH BAGUS dari
cap=360 (1,58/1,36) MAUPUN cap=180 (1,61/1,36) di KEDUA era, bukan cuma salah satu. Buat Emas,
cap=360 kelihatan oke di 2 era (2,29/2,06 vs baseline 2,39/1,97) TAPI cap=180 gagal jelas di
2 era (1,88/1,74).
**Sensitivitas parameter:** **GAGAL total buat Emas** -- cap=360 vs cap=180 (parameter TETANGGA)
hasilnya beda jauh (PF 2,14 vs 1,80 full-period, dan beda ~0,3-0,5 di tiap era) -- pola klasik
overfitting/false positive, PERSIS yang harusnya ketangkep sama tes sensitivitas ini. BTC lolos
sensitivitas (360 & 180 konsisten SATU SAMA LAIN) tapi keduanya KONSISTEN LEBIH JELEK dari
baseline -- konsistensi gak nolong kalau arahnya sama-sama salah.
**Review sub-agent (Peninjau Skeptis):** independen dikasih angka mentah TANPA kesimpulan --
verdict REJECT buat DUA aset, alasan sama kayak di atas + nangkep kelemahan (data per-tahun Emas
gak ada, otomatis gagal Rule 1 buat Emas). Sepakat sama analisaku sendiri.
**Kesimpulan:** **TIDAK CUKUP KUAT / overfitting-like.** Observasi Olan soal "ini kok kayak gaya
Sniper, bukan Nyopet" itu BENAR secara arsitektur (kode-nya emang numpang mesin yang sama, gak
di-rescale kayak window pola grafik) -- TAPI ngebatesin umur gap SECARA ARTIFISIAL buat "biar
lebih Nyopet" JUSTRU nurunin PF buat BTC, dan gak robust buat Emas. Kesimpulannya: walau
kedengeran gak konsisten sama filosofi "Nyopet=cepat", perilaku SEKARANG (gak dibatasin)
ternyata lebih nguntungin secara angka -- jangan diubah cuma demi konsistensi nama/filosofi.
**Rekomendasi lanjutan (BUKAN buat sekarang):** kalau mau dicoba lagi lain waktu, coba nilai cap
lain (270, 450) + WAJIB bikin breakdown per-tahun Emas juga (kelemahan riset ini) sebelum
disimpulkan ulang.
**Status implementasi:** TIDAK diterapkan. Live tetap pakai FVG tanpa batas umur gap (perilaku
sekarang, terbukti lebih baik di backtest ini).

---


### 2026-08-31 — [BLOKIR INFRASTRUKTUR, bukan temuan riset] Sesi cloud gak bisa riset apa-apa — network egress environment ini diblokir total ke semua sumber data harga
**Apa yang terjadi:** Jalanin rutinitas normal (git pull, baca log ini, mau pilih ide dari daftar "belum
dicoba"), tapi begitu coba refresh data (`node backtest/refreshCache.js`) langsung gagal:
`HTTP 403: Host not in allowlist: data-api.binance.vision`. Dicek lebih jauh:
- Cache lokal (`hourly-cache.json`, `daily-cache.json`, `gold-*-cache.json`, `dxy-cache.json`) MEMANG
  gak ada di clone environment cloud ini (sengaja di-gitignore, regeneratable) -- normalnya di-generate
  ulang via `refreshCache.js`/`refreshGoldCache.js`/`refreshDxyCache.js`, tapi ketiganya butuh akses
  network yang ternyata diblokir semua di environment remote ini.
- Dicoba manual satu-satu: `data-api.binance.vision`, `api.binance.com`, `query1.finance.yahoo.com`,
  `api.coingecko.com` -- SEMUA balas "Host not in allowlist" dari network egress proxy environment ini
  (bukan masalah kode/typo, ini kebijakan jaringan level environment).
- Satu-satunya data harga yang KE-COMMIT beneran di repo ini cuma `web/data/btc-history.json` (BTC
  harian 2014 s/d 2026-08-06 doang, cuma OHLC tanpa volume, format field beda dari yang dipakai
  engine backtest lain, gak ada versi hourly/4H). Itu udah pernah dipakai buat 1 temuan seasonality
  (lihat `KNOWLEDGE/metodologi-analisa-teknikal.md`), tapi TIDAK cukup lengkap/segar buat riset baru
  yang jujur dan lolos rigor 3-lapis (gak ada breakdown 4H buat Nyopet, dan datanya udah ~25 hari
  ketinggalan dari hari ini).
**Keputusan:** daripada maksain riset pakai data yang gak lengkap/gak reliable terus dibungkus
kelihatan meyakinkan (itu justru ngelanggar prinsip kejujuran file ini), aku putuskan TIDAK menguji
ide apapun hari ini. Gak ada entri "Ide-ide belum dicoba" yang dihapus -- semuanya masih nunggu.
**Kesimpulan:** ini BUKAN temuan riset (positif/negatif) -- ini laporan blocker operasional.
**Rekomendasi buat Olan:** kalau mau routine cloud jalan tiap hari kayak yang dimaksud, environment
remote-nya perlu di-allowlist buat minimal `data-api.binance.vision` (BTC) dan `query1.finance.yahoo.com`
(DXY) di pengaturan network egress environment ini. Alternatif lain: cache hourly/daily/gold/dxy
di-commit manual berkala dari sesi lokal (walau biasanya sengaja digitignore karena regeneratable &
lumayan gede) supaya sesi cloud selalu punya data buat dianalisis walau gak bisa fetch sendiri.
**Status implementasi:** N/A — gak ada perubahan kode/live, gak ada temuan buat diterapkan.

---

### 2026-08-30 — DXY (Dollar Index) confirmation filter, entry Nyopet & Sniper
**Ide:** filter tambahan di titik ENTRY (bukan exit/manajemen posisi yang udah jalan) —
skip entry LONG kalau dolar lagi "kuat" (DXY daily close >= SMA20 dolar sendiri). Hipotesis:
dolar lemah = kondisi makro lebih ramah buat aset risk-on (BTC) dan emas.
**Metode:** DXY harian dari Yahoo (`DX-Y.NYB`), SMA20 sebagai parameter default (dibikin
sengaja bulat/simpel biar gak overfit dari awal). Diuji terpisah utk Sniper (BTC+Emas) dan
Nyopet v2 (BTC+Emas) karena beda mesin sinyal.
**Hasil:**
- **Nyopet (BTC & Emas): LULUS split-era DAN LULUS sensitivitas parameter (SMA10/20/50).**
  Efeknya konsisten di 2 era independen, gak collapse pas parameter digeser →
  **edge asli, DITERAPKAN LIVE** (skip entry Nyopet kalau DXY weak-check gagal). Lihat
  `dxyContext.js` (`isDxyWeak`) + `nyopetAutoTrader.js`.
- **Sniper (BTC & Emas): GAGAL rigor check.** Angka agregat awal kelihatan bagus, TAPI
  perbaikannya ternyata konsentrasi di tahun anomali tunggal (2023 utk BTC, 2025 utk Emas)
  dan runtuh pas parameter SMA digeser dari 20 → indikasi kuat overfitting/kebetulan, bukan
  edge asli. **TIDAK diterapkan ke Sniper.**
**Kesimpulan:** Pelajaran metodologi penting — proses rigor 3-lapis ini BERHASIL membedakan
edge asli (Nyopet) dari yang cuma keliatan bagus di permukaan (Sniper). Jadi baseline wajib
buat SEMUA riset selanjutnya di file ini.
**Status implementasi:** Nyopet — LIVE. Sniper — tidak diterapkan (correctly rejected).

---

## Ide-ide yang BELUM dicoba (kandidat buat riset besok, hapus dari daftar kalau udah dites)

- Indikator makro lain sebagai konfirmasi entry (COT report positioning, Fear&Greed Index level,
  korelasi DXY-Emas terpisah dari DXY-BTC) -- funding rate BTC UDAH DITES 14 Sep 2026, REJECTED
  (lihat "Temuan Terbaru" di atas), jangan diulang persis sama tanpa ide baru
- Parameter sweep lookback window Nyopet v2 (saat ini di-rescale ×6 dari tuning harian ke 4H
  — belum pernah divalidasi ulang secara independen apakah ×6 itu optimal)
- Parameter sweep exit rule (partial 50% di 2R + trailing SMA60 — kenapa 2R dan SMA60
  spesifik itu, apa ada kombinasi lain yang lebih robust di split-era test)
- Filter volatilitas (skip entry kalau ATR/volatility terlalu rendah/tinggi dari rata-rata)
- Time-of-day / day-of-week filter untuk Nyopet 4H (apa ada sesi tertentu yang secara
  konsisten lebih/kurang reliable)
