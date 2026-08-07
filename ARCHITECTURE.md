# Kaela Trading Engine — Architecture

Rule-Based Trading Decision Engine. Kaela adalah anggota tim (bukan produk "AI"), menjalankan sistem ini sebagai salah satu tugasnya.

Status: **Desain disepakati + Fase 1 (Signal Engine & Backtest) SELESAI dan tervalidasi.** Dokumen ini acuan sebelum lanjut ke Fase 2 (implementasi live).

---

## 0. Filosofi (tidak berubah dari brief awal)

Deterministik. Tidak ada prediksi, tidak ada intuisi, tidak ada trading diskresioner. Prioritas: **Consistency → Money Management → Capital Preservation → Long-Term Compounding → Simple Rules → Fully Automated**.

**Update pasca-backtest:** BTC historis punya bias naik jangka panjang (secular uptrend) — melawan arah itu (short) terbukti rugi dibanding sekadar diam. Sistem final jadi **LONG-ONLY** (sinyal SELL diabaikan/dianggap WAIT). Konsekuensinya winrate malah lebih tinggi dari dugaan awal (~50-61% pada backtest), bukan 30-45% seperti sistem 2-arah biasa.

---

## 1. Modular Architecture

Enam engine, masing-masing satu tanggung jawab:

```
Binance API (candle Daily + 4H)
        ↓
[1] SIGNAL ENGINE
    - Hitung SuperTrend sendiri (ATR period 14, multiplier 3) per timeframe
    - Hitung Structure/Trend logic sendiri (setara-SMC, swing high/low, lookback 5 bar)
    - Kedua indikator harus AND (setuju) baru timeframe itu dianggap BUY/SELL,
      kalau enggak → WAIT dengan alasan spesifik disimpan
    - Daily AND 4H harus align baru Final Signal keluar
    - **LONG-ONLY**: kalau hasilnya SELL, diperlakukan sebagai WAIT (gak pernah short BTC)
        ↓
[2] LIFE ENGINE
    - Ambil Entry Zone (titik tengah dipakai sbg acuan) + Risk Area dari Signal Engine
    - Risk Distance % = |Entry_mid − Risk Area| / Entry_mid
    - Leverage = **floor** (1 / Risk Distance%), clamp [1,150], integer
      (floor, bukan round — dibulatkan ke atas bisa bikin rugi >100% modal di 1 trade, ketauan pas backtest)
    - SL = titik Liquidation (tidak ada order SL manual terpisah)
    - TP Distance = Risk Distance × 1,5  (Risk:Reward 1:1,5 — hasil terbaik dari sweep, bukan 1:3 seperti draf awal)
        ↓
[3] MONEY MANAGEMENT ENGINE (OLZ Exposure System)
    - Base Exposure berdasar bracket modal (Confirmation Factor: DIHAPUS, pakai exact base)
      $1-9→12x | $10-99→6x | $100-999→3x | $1rb-9,999→1.5x | $10rb-99,999→0.75x
      (tiap naik 10x kekayaan, exposure jadi separuh, berlanjut ke atas)
    - Volume (Position Value) = Capital × Exposure
    - Margin = Volume ÷ Leverage, **dijamin ≤ Capital** (Exposure efektif = min(Base Exposure, Leverage))
    - **Risk-Per-Trade DINAMIS** (temuan penting Fase 1 — lihat bagian 7): modal yang BENERAN
      dipertaruhkan per-trade cuma sebagian saldo, bukan semua. Saldo < $1000 → 100% saldo jadi
      taruhan (agresif, ada jaring pengaman top-up). Saldo ≥ $1000 → cuma 50% saldo per-trade
      (konservatif, sisanya jadi bantalan, gak ada top-up lagi)
        ↓
[4] PAPER TRADING ENGINE (Kaela sendiri)
    - Saldo virtual mulai $100, ikut Final Signal 100% disiplin
    - Compounding: saldo baru = basis Exposure trade berikutnya
    - Auto-close saat harga sentuh TP atau Liq (dicek tiap tick harian)
    - Ini SATU-SATUNYA trading yang diarsipkan/publik
        ↓
[5] BROADCAST ENGINE — DIDESAIN ULANG (strategi final trading ~2x/4 tahun, bukan harian)
    Dua pesan terpisah ke grup, sumber kode terpisah tegas (satu gak pernah manggil yang lain):

    A. 📊 KAELA REPORT (groupReport.js + dailyReport.js untuk Olan pribadi)
       - Jadwal: ikut jam CLOSING CANDLE, 07:00 WIB (UTC 00:00)
         Harian: tiap hari | Mingguan: tiap Senin | Bulanan: tanggal 1 | Tahunan: 1 Januari
       - Isi: harga BTC + % perubahan vs periode sebelumnya, status TUNAI/OPEN, countdown ke window
       - Selama window Musim Tanam/Panen: tambahan pesan pengingat komitmen (ramah, gonta-ganti,
         TIDAK PERNAH sebut nominal modal siapapun) — nujuh anggota ke rencana mereka sendiri, bukan tekanan baru
       - Anggota grup dianggap sudah di-briefing risiko sebelum join (bukan tanggung jawab Kaela)

    B. 📰 KAELA NEWS (newsUpdate.js)
       - Jadwal: 09:00 WIB tiap hari (beda dari Report, biar gak numpuk 1 waktu)
       - Cakupan: ekonomi GLOBAL + INDONESIA, apapun yang mempengaruhi ekonomi (gak cuma kripto)
       - Format: judul + sumber aja (bukan ringkasan panjang) — 1 sampai maks 10 item, fleksibel
       - Tag sentimen: 🟢 positif / 🔴 negatif / ⚪ netral, tanpa bias
       - ⚠️ MURNI INFORMASI — modul ini gak pernah dipanggil oleh signal/backtest/logic tanam-panen manapun

    C. ⚡ NYOPET MARKET (nyopetLog.js) — SIDE-EXPERIMENT, terpisah total dari Siklus Halving
       - **SPEK FINAL** (dipilih dari sweep sistematis 315 kombinasi, backtest/nyopetSweep.js —
         cari kombinasi Nyawa x Stake x RR x Timeframe dgn CAGR terbaik yg Max DD masih <=50%):
           Timeframe : Hourly (trigger entry) + Weekly (filter arah, harus BULLISH)
           Arah      : LONG-ONLY (short dibuang total — short-only test rugi -86,4%, no-go)
           Nyawa (SL): 10% -> Leverage 10x (floor(1/0.10))
           TP        : TUNGGAL di RR 1:2 (bukan tiered 1/2/3 lagi — versi tiered kalah di sweep)
           Stake     : 15% saldo TERBARU tiap entry (compound otomatis, ikut naik-turun saldo)
       - Hasil backtest jujur, 9 tahun data Binance (2017-2026), 71 trade, walk-forward-safe:
         **CAGR 20,1%/tahun, winrate 45,1%, Max Drawdown 47,0%**
         (dibanding Siklus Halving: CAGR 73,8%/tahun, Max DD 0% — Nyopet Market TETAP kalah jauh dan
         JAUH lebih berisiko; ini side-experiment modal super mini, BUKAN pesaing strategi utama)
       - Kirim ke WEB (arsip) DAN grup WA, tiap syarat terpenuhi: ENTRY, lalu SL atau TP kena
       - 🚨 Disclaimer keras "JANGAN ALL-IN, stake wajib 15% — titik" wajib nempel di tiap ENTRY
       - Sinyal TIDAK PERNAH sebut nominal saldo/stake dalam dolar
       - Modal super mini, gak boleh dicampur ke modal Siklus Halving

    - Searah total: tidak baca command, tidak respon DM
    - Target: 1 Group ID spesifik saja (grup lain yang Kaela ikuti — AMA-TMS, dst — tidak pernah tersentuh)
        ↓
[6] REPORTING ENGINE
    - Laporan Mingguan: tiap Minggu jam 24:00
    - Laporan Bulanan: akhir bulan jam 24:00
    - Isi: saldo awal→akhir, %growth/merosot, jumlah trade, win rate, max drawdown
    - Jadi bahan evaluasi bulanan bareng Olan
```

**Kalkulator Web** bukan bagian dari engine di atas — dia klien murni. Halaman statis yang baca parameter tetap 1 sinyal (Leverage, Exposure table, TP ratio — semua sudah fix begitu sinyal terbit), dan menghitung Volume/Margin/TP/Liq **di browser user**, real-time saat mereka mengetik modal. Tidak ada data yang pernah dikirim ke server → privasi total, tidak ada user yang tercatat.

---

## 2. Database Design

Karena tidak ada data user yang disimpan (kalkulator anonim), skema ini ringan — cuma nyimpen apa yang Kaela lakukan sendiri.

| Tabel | Kolom Inti | Keterangan |
|---|---|---|
| `signals` | signal_id (mis. `BTC-20260806-001`), direction, entry_low, entry_high, risk_area, risk_distance_pct, leverage, tp_price, status (OPEN/HOLD/CLOSED), close_reason (TP/LIQ), created_at, closed_at | Satu baris per sinyal yang pernah terbit |
| `indicator_state` | date, timeframe, supertrend_state, structure_state | Log harian tiap indikator — dasar buat alasan "No-trade" |
| `kaela_balance_log` | date, signal_id (FK), balance_before, balance_after, pnl_pct | Histori saldo virtual — sumber grafik growth |
| `reports` | period_type (weekly/monthly), period_start, period_end, start_balance, end_balance, pct_change, win_rate, max_drawdown, trades_count | Snapshot laporan yang sudah digenerate |
| `broadcast_log` | date, message_type (A/B/C), content, sent_at | Audit trail pesan yang dikirim ke grup |

Tidak ada tabel `users` — sengaja, sesuai keputusan privasi.

---

## 3. API / Fungsi

Bukan REST API besar — mayoritas scheduled job + 1 web app ringan (rekomendasi: **Google Apps Script**, konsisten sama seluruh ekosistem Kaela yang lain, gratis, sudah terbukti stabil di AMA-TMS/TP-IMS/HeavyTrack — bukan stack Python terpisah seperti draf awal, supaya sejalan dengan prinsip "gratis dulu, no bayar-bayar").

- `runDailyCheck()` — time-driven trigger 07:00 WIB. Fetch candle Binance → Signal Engine → Life Engine → Money Mgmt (utk saldo Kaela) → Paper Trading Engine → Broadcast Engine → simpan log.
- `runWeeklyReport()` — time-driven trigger Minggu 24:00.
- `runMonthlyReport()` — time-driven trigger akhir bulan 24:00.
- `doGet(e)` — web app, 2 route:
  - `?page=calculator&id=SIGNAL_ID` → render halaman kalkulator (data sinyal itu di-embed ke HTML, hitung di JS client-side)
  - `?page=dashboard` → render arsip histori + grafik saldo Kaela + laporan

---

## 4. WhatsApp Bot Design

- Reuse nomor & device Fonnte yang sudah ada (tidak perlu nomor baru — isolasi sudah aman di level Group ID, nomor baru cuma opsi jaga-jaga kalau nanti volume/risk jadi masalah nyata).
- 1 fungsi kirim: `sendToTradingGroup(text)` — target 1 Group ID yang di-hardcode di config.
- Grup WA: setting "Only admins can send messages", nomor Kaela **wajib jadi Admin grup** (bukan member biasa) supaya tetap bisa posting.
- Tidak ada inbound handler untuk fitur ini — Kaela tidak membaca command atau membalas DM di konteks trading.

---

## 5. Data Integration Design (Binance, bukan TradingView)

- Sumber data: **Binance public REST API** (`/api/v3/klines`), symbol `BTCUSDT`, interval `1d` dan `4h`. Gratis, tanpa API key, tanpa langganan.
- **SuperTrend**: dihitung sendiri dari formula ATR standar (publik, well-documented) — bukan pakai script AlgoAlpha berbayar.
- **Structure/Trend logic (pengganti SMC LuxAlgo)**: dihitung sendiri berbasis swing high/low (fractal pivot) + break-of-structure — versi kita sendiri, tidak meniru persis rahasia dagang LuxAlgo, tapi setara secara fungsi (deteksi perubahan struktur tren).
- **Kombinasi**: dalam 1 timeframe, SuperTrend AND Structure harus SETUJU baru dianggap valid (mengurangi sinyal palsu). Lintas timeframe: Daily AND 4H harus align baru Final Signal terbit.
- Tidak ada dependency ke TradingView sama sekali —360° dikontrol sendiri, bisa di-backtest kapan saja terhadap data historis Binance.

---

## 7. Hasil Validasi Fase 1 (Backtest, 9 tahun data BTCUSDT Binance, 2017-2026)

**Perjalanan menemukan config final** (ringkas — histori penuh ada di transkrip diskusi):
1. Versi awal (short diizinkan, all-in tiap trade): **RUGI** dibanding modal disetor. Ketemu 3 bug matematis (Margin bisa > Capital, top-up ikut kena leverage trade yang lagi jalan, leverage dibulatkan ke atas bisa bikin rugi >100%) — semua sudah diperbaiki.
2. Setelah bug fix + sweep 576 kombinasi parameter: winrate wajar tapi **masih kalah dari sekadar HODL BTC polos** (475% vs HODL 1.409%). Ternyata sistem 56% harinya WAIT (gak exposed) dan 19% harinya SELL (lawan tren BTC yang secara historis naik terus).
3. **Long-only** (buang short) + **risk-per-trade sizing** (gak all-in tiap trade) → lompatan besar, akhirnya ngalahin HODL dan strategi timing-siklus-halving sekaligus.

**Perbandingan final (CAGR = compound annual growth rate, cara adil buat bandingin lintas horizon waktu):**

| Strategi | CAGR/tahun | Max Drawdown | Risiko Liquidasi |
|---|---|---|---|
| BTC Buy & Hold polos | 35,2% | - | Tidak ada |
| Timing siklus halving (akumulasi→jual~18bln pasca halving→ulang) | ~52%* | - | Tidak ada |
| **Kaela — Long-only, risk-per-trade DINAMIS (config final)** | **71,5%** | **54%** | Ada, tapi terkendali |

*(estimasi CAGR dari multiple 37,43x selama 2 siklus ~8 tahun)*

**⚠️ UPDATE — Dua jalur eksekusi, tegas dipisah:**

- **DEFAULT (buat semua anggota grup): SPOT, tanpa leverage.** Beli BTC biasa di Musim Tanam, tahan, jual di Musim Panen. Tidak ada Batas Rugi/likuidasi — cuma naik-turun harga biasa. Ini yang direkomendasikan ke semua orang.
- **LANJUTAN (opsional, hak masing-masing): Leverage pakai OLZ Exposure System.** Buat yang berani ambil risiko tambahan dan mau kelola sendiri (pakai `calculator.js`). WAJIB disclaimer jelas: risiko likuidasi nyata, beda total dari sekadar spot.
- **⚠️ ATURAN TEGAS: Leverage CUMA boleh di titik masuk Musim Tanam (bottom).** Di luar titik itu (termasuk top-up bulanan sebelum Musim Tanam tiba, atau pembelian kapanpun di luar window), WAJIB spot. Leverage kita dihitung khusus dari jarak struktural ke bottom yang tervalidasi — bukan aturan umum yang boleh dipakai sembarang waktu.

Rencana Olan sendiri tetap pakai jalur Leverage (leverage-by-bracket, sudah divalidasi backtest). Hasil backtest CAGR 73,8-82,1% itu HASIL LEVERAGE, bukan hasil spot polos — spot polos historisnya ~35,2%/tahun (buy & hold biasa, tetap jauh lebih baik dari kebanyakan investasi lain, tapi jangan disamain sama angka leverage).

---

**⚠️ UPDATE — Strategi final BERUBAH TOTAL dari signal-engine harian ke strategi Siklus Halving.** Setelah signal engine (SuperTrend+Structure harian) dibandingkan langsung ke benchmark HODL & timing-halving, dan berbagai eksperimen lanjutan (SL tetap, filter kalender, long+short, musiman) diuji ketat pakai walk-forward validation, **cuma satu yang lolos semua uji jujur: strategi Siklus Halving murni.**

### STRATEGI FINAL: Siklus Halving (bukan signal harian)

- **Beli** di titik BOTTOM (rata-rata 513-542 hari SEBELUM tanggal halving berikutnya — pola paling konsisten yang ditemukan, walk-forward dari siklus-siklus sebelumnya)
- **Tahan** posisi LONG dengan **Leverage berdasar bracket kekayaan** (makin kecil saldo, makin agresif — filosofi inti dari awal proyek):
  | Saldo | Leverage | SL implisit |
  |---|---|---|
  | $1-99 | 12x | 8,3% |
  | $100-999 | 6x | 16,7% |
  | $1.000-9.999 | 3x | 33,3% |
  | $10.000-99.999 | 2x | 50% |
  | $100.000+ | 1x | 100% |

  (Catatan: bracket $1-99/12x belum pernah teruji langsung di backtest 3 siklus kita — saldo gak pernah lama di situ karena top-up bulanan. Kalau live nanti kebetulan trade jatuh pas saldo di bracket itu, tetap harus waspada.)
- **Jual** di titik rata-rata hari-ke-puncak dari siklus-siklus SEBELUMNYA (368, lalu 526, lalu 549 hari pasca halving — terus dirata-rata secara walk-forward, BUKAN dari siklus itu sendiri)
- **Antara siklus**: tunai/nunggu sampai window BOTTOM siklus berikutnya
- **LONG-ONLY** — short via cara apapun (sinyal harian, filter kalender, walk-forward peak-timing) TERBUKTI GAGAL di semua percobaan karena timing puncak siklus jauh lebih gak presisi (rentang 180 hari) dibanding bottom (rentang 30 hari)
- **Top-up bulanan (gajian tanggal 5): $100/bulan, JALAN TERUS sampai saldo PERTAMA KALI nyentuh $1.000, lalu berhenti selamanya** (walau saldo turun lagi nanti karena trading, gak resume). Di atas $1.000, pertumbuhan murni dari smart trading, bukan setoran lagi.
- **Hasil tervalidasi (3 siklus penuh, walk-forward, 2015-2025, leverage-by-bracket + top-up bulanan):** Total disetor $500, saldo akhir **$288.911**, CAGR **73,8%/tahun**, Max Drawdown realisasi **0%** (semua 3 trade closed sesuai jadwal) — jauh melewati target $100k user.

### Catatan Pola Bottom Siklus (referensi resmi)

| Halving | Bottom | Bulan | Harga | Jarak ke Halving |
|---|---|---|---|---|
| 2016-07-09 | 2015-01-14 | Jan 2015 | $171,51 | 542 hari |
| 2020-05-11 | 2018-12-15 | Des 2018 | $3.191,30 | 513 hari |
| 2024-04-19 | 2022-11-21 | Nov 2022 | $15.599,05 | 515 hari |

Rata-rata: **523 hari sebelum halving** (rentang 513-542, paling konsisten dari semua pola yang diuji).

**Proyeksi siklus berjalan (diupdate pakai sumber real-time CoinGecko, lebih akurat dari ekstrapolasi manual):**

- **Estimasi halving berikutnya: 13 April 2028, 13:11 UTC** (sumber: coingecko.com/en/coins/bitcoin/bitcoin-halving, live countdown berbasis data blockchain — dicek ulang berkala karena estimasi ini bisa bergeser sedikit seiring waktu)
- **Estimasi window bottom siklus ini: 19 Oktober – 17 November 2026** (titik tengah ~7 November 2026)

Per Agustus 2026: harga sempat ke titik terendah $57.748 (1 Jul 2026) — **ini SEBELUM window estimasi dimulai**, jadi kemungkinan besar BUKAN bottom sungguhan (bottom asli diperkirakan masih di depan, Okt-Nov 2026). Harga sekarang $64.619 (+11,9% dari titik itu) — bisa jadi pantulan sementara sebelum turun lagi ke bottom asli, bukan awal recovery. Ikuti aturan kalender (walk-forward), jangan buru-buru masuk cuma karena harga udah mantul.

Signal Engine harian (SuperTrend+Structure, bagian 1 di atas) **tetap didokumentasikan sebagai riset yang sudah dijalani** — hasilnya positif (CAGR 71,5-83,7%) tapi kalah robust dibanding Siklus Halving (drawdown nyata 54-57% vs 0%, dan cuma diuji di 1 rezim pasar vs 3 siklus independen). Bisa dipertimbangkan lagi di masa depan sebagai pelengkap kalau ada modal nganggur, TAPI bukan strategi utama.

**Config final signal-engine (kalau dipakai sebagai pelengkap):** ATR period 14, multiplier 3, Structure lookback 5 bar, kombinasi AND, Risk:Reward 1:1,5, Long-only, Risk-per-trade dinamis (100% di bawah $1000, 50% di atasnya).

**Perilaku waktu bear market 2022 (stress-test paling penting):** 3 kerugian kecil terkontrol berurutan (masing-masing -9% s/d -16%), BUKAN satu kehancuran besar — sistem berhenti cari entry baru begitu tren jelas turun, sesuai desain long-only.

**⚠️ Batasan yang harus diingat (jangan lupa waktu evaluasi bulanan nanti):**
- Ini hasil **in-sample optimization** (parameter dicari dari data yang sama dipakai buat nge-tes) — risiko overfitting nyata meski udah dicek gak didominasi 1-2 trade beruntung. Belum divalidasi out-of-sample (data yang belum pernah "dilihat").
- **Long-only berasumsi BTC terus punya bias naik jangka panjang.** Kalau suatu saat itu berhenti benar (BTC masuk fase sideways/turun panjang bertahun-tahun), sistem ini cuma akan diam (WAIT) — gak akan rugi parah, tapi juga gak akan untung dari penurunan itu (beda dari sistem 2-arah yang bisa short).
- Sample masih kecil (~36 trade dalam 9 tahun) — kesimpulan statistik belum sekuat kalau datanya lebih panjang/banyak aset.
- Live trading nanti WAJIB dimulai dari Paper Trading (saldo virtual $100) dulu sebelum dipercaya penuh — bukan langsung dianggap "terbukti" dari backtest aja.

---

## 6. Roadmap

| Fase | Isi | Syarat lanjut |
|---|---|---|
| **0. Desain** (selesai) | Spec, arsitektur, DB, API — dokumen ini | — |
| **1. Signal Engine + Backtest** (SELESAI) | Bangun SuperTrend & Structure logic, tarik data historis Binance, backtest & sweep parameter | ✅ Config final ketemu, ngalahin HODL & timing-halving (lihat bagian 7) |
| **2. Paper Trading + Database** | Bangun Money Mgmt, Life Engine, Paper Trading Engine (pakai config final Fase 1), skema DB | Simulasi jalan konsisten di data historis |
| **3. Broadcast Engine (WA)** | Reuse Fonnte, bikin grup trading, admin-only, kirim 3 jenis pesan harian | Tes kirim ke grup beneran |
| **4. Kalkulator Web** | Halaman statis, hitung client-side, link per-sinyal | User beneran bisa hitung Volume/Margin/TP/Liq dari HP |
| **5. Dashboard/Arsip** | Histori sinyal, grafik saldo Kaela, laporan mingguan/bulanan | Data ke-generate otomatis sesuai jadwal |
| **6. Go-Live** | Jalan harian beneran, Kaela mulai trading paper $100 | 30 hari berjalan tanpa bug fatal |
| **7. Evaluasi Bulanan #1** | Review bareng Olan — cari kelemahan, perkuat yang oke | Siklus rutin bulanan seterusnya |

---

## Tabel Exposure — Versi Resmi Anti-Ketuker

Baca pakai **≥ dan <**, jangan pakai rentang dua angka (itu sumber ketuker berulang kali):

| Modal | Exposure |
|---|---|
| ≥ $1 dan < $10 | 12× |
| ≥ $10 dan < $100 | 6× |
| ≥ $100 dan < $1.000 | 3× |
| ≥ $1.000 dan < $10.000 | 1,5× |
| **≥ $10.000 dan < $100.000** | **0,75×** |
| ≥ $100.000 dan < $1.000.000 | 0,375× |
| ≥ $1.000.000 dan < $10.000.000 | 0,1875× |

**Titik peralihan yang sering ketuker** (hafalkan ini):
- Modal $9.999 → masih 1,5×
- **Modal $10.000 → PINDAH ke 0,75×** (persis di angka ini, bukan di atasnya)
- Modal $99.999 → masih 0,75×
- Modal $100.000 → pindah ke 0,375×

Pola: tiap modal naik 10×, Exposure dibagi 2 — berlanjut ke atas maupun ke bawah tanpa batas.

---

## Keputusan Kunci (ringkasan cepat)

- **Murni teknikal & data — TIDAK ADA analisa fundamental/berita** yang ikut mempengaruhi sinyal (perang, korupsi, dll). Dipertimbangkan dan ditolak: gak bisa di-backtest, gak konsisten sama filosofi deterministik, dan pola historis (siklus halving) sudah terbukti tetap jalan melewati berbagai krisis besar (COVID, perang Rusia-Ukraina, dst) tanpa perlu penyesuaian.

- Confirmation Factor: **dihapus**, exact Base Exposure
- Leverage = **floor(1 / Risk Distance%)**, clamp [1,150], SL = titik Liquidation (bukan order manual)
- TP = **Risk:Reward 1:1,5** (hasil sweep, bukan 1:3 seperti draf awal)
- **LONG-ONLY** — sinyal SELL diabaikan (BTC punya bias naik jangka panjang, short terbukti rugi di backtest)
- **Risk-per-trade DINAMIS**: 100% saldo di bawah $1000 (agresif), 50% saldo di atasnya (konservatif) — bukan all-in tiap trade
- Entry Zone reference = **titik tengah**
- Data sinyal = **hitung sendiri dari Binance**, bukan TradingView (gratis, tanpa dependency pihak ketiga)
- Kalkulator = **anonim, client-side, tanpa data user tersimpan**
- Modal >$1000 tidak boleh top-up = **disclaimer teks aja**, tidak di-enforce sistem
- 1 hari maksimal **1 trade**, tidak overlap
- WA: **nomor lama**, grup admin-only, Kaela cuma broadcast searah
- Fase 1 (Signal Engine + Backtest): **SELESAI** — config final CAGR 71,5%/tahun, Max DD 54%, ngalahin HODL (35,2%) & timing-halving (~52%). Kode backtest ada di `backtest/` (Node, jalankan `node sweep.js` buat reproduce)
