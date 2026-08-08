# Metodologi Analisa Teknikal — Referensi Kaela

Dokumen ini kumpulan ilmu yang dipelajari Kaela (riset internet + praktik langsung bareng Olan) buat analisa BTC di Nyopet Market. Terus diperbarui, bukan sekali tulis selesai.

## 1. Prinsip dasar (dari riset)

- **Multi-timeframe analysis adalah satu perbaikan paling berdampak** buat strategi berbasis indikator. Mulai dari timeframe besar (Weekly/Daily) buat arah/bias, baru turun ke timeframe kecil (4H/1H) buat timing entry presisi. — [Excavo, Multi-Timeframe Trading Framework 2026](https://excavo.com/blog/multi-timeframe-trading-indicators)
- **Kombinasi yang populer:** day trading pakai 1H entry + 4H bias; swing trading pakai 4H entry + Daily bias.
- **Konfluensi ningkatin akurasi signifikan** — indikator tunggal di kripto cuma ~52% hit rate, tapi konfluensi bisa dorong ke atas 70%. — [FinanceFeeds](https://financefeeds.com/best-chart-time-intervals-for-crypto-traders/)
- **Aturan konflik:** kalau timeframe besar bearish tapi timeframe kecil kasih sinyal buy, SKIP trade itu — jangan pernah lawan tren timeframe besar.
- **Disiplin risk management:** trader berpengalaman fokus ke sedikit setup BERKUALITAS per minggu, bukan cari-cari aksi tiap jam.

## 2. Liquidity Sweep / Stop Hunt (Smart Money Concepts)

Ini istilah resmi buat teori "bandar narik ke dua arah" yang kita bahas — TERBUKTI konsep nyata, bukan cuma teori orang awam.

- **Definisi:** harga menembus level di mana banyak stop-loss/entry breakout menumpuk (di atas high jelas atau di bawah low jelas), MENGISI order-order itu, lalu GAGAL bertahan dan berbalik arah. — [LuxAlgo](https://www.luxalgo.com/library/concept/liquidity-sweep/), [Alchemy Markets](https://alchemymarkets.com/education/strategies/liquidity-sweep/)
- **Cara kerja:** likuiditas ngumpul di level jelas (high/low terakhir). Retail naruh stop-loss di situ. Smart money dorong harga ke zona itu buat "makan" stop-stop itu, baru masuk posisi ke arah BERLAWANAN setelah itu.
- **Cara trading pola ini:**
  1. Tentuin arah pasar dari timeframe besar.
  2. Tandai zona likuiditas (level kunci/high-low mencolok).
  3. Tunggu sweep beneran terjadi (harga nembus level itu).
  4. Cari tanda reaksi (wick penolakan, fair value gap terisi, order block tersentuh).
  5. Entry SETELAH konfirmasi, SL di luar titik sweep, target di zona likuiditas berikutnya.
- **Istilah terkait yang sama maksudnya:** "grab", "purge", "raid", "stop run", "stop hunt" — semua nunjuk pola yang sama.

## 3. Peran AI/LLM dalam analisa trading — batasan jujur

Ini penting buat Kaela sendiri pahami posisinya:

- **LLM itu "junior analyst", BUKAN oracle.** Berguna buat percepat riset (cari edge case, analog historis, celah logika di thesis kita) — BUKAN karena punya "alpha"/keunggulan prediktif bawaan. — [ForTraders, AI Trading 2026](https://fortraders.com/blog/ai-trading)
- **Ekspektasi realistis:** prediksi AI itu SINYAL ARAH, bukan bola kristal. Edge realistis cuma 3-8% perbaikan dari baseline -- BUKAN klaim marketing "winrate 80%".
- **Risiko nyata:** model bisa overfitting, gagal pas regime pasar berubah, sensitif ke kualitas data (data finansial itu noisy & gak stasioner).
- **Cara pakai yang benar:** AI/LLM buat SCREENING & scenario planning, entry final tetap butuh cek level manual + aturan risiko manusia. Kombinasi: 1 scanner + 1 charting platform + 1 jurnal, biar ada double-confirmation sebelum ambil keputusan.

**Implikasi buat Kaela:** jangan pernah overclaim "pasti benar". Selalu kasih alasan (sudah jadi aturan proyek ini juga, lihat [[feedback-nyopet-selalu-beralasan]]), akui kalau ada ketidakpastian, dan anggap tiap analisa sebagai HIPOTESIS yang diuji pasar -- bukan kepastian.

**Riset lanjutan (8 Agu 2026): kenapa sebagian orang berhasil "trading bareng AI" dan sebagian gagal?**
Cerita viral (winrate 100% dsb) kebanyakan gak bisa diverifikasi. TAPI temuan yang konsisten di banyak sumber: **"AI memperkuat disiplin, bukan menciptakan disiplin. Trader yang manajemen risikonya jelek bakal rugi LEBIH CEPAT pakai AI, bukan lebih lambat."** Faktor pembeda BUKAN kecerdasan AI-nya, tapi disiplin dasar trader-nya (potong rugi, gak overleverage, gak emosi) -- AI cuma tools yang mempercepat proses itu, baik ke arah bagus maupun jelek. Ini alasan kenapa aturan-aturan ketat Nyopet Market (JANGAN ALL-IN, konfirmasi candle wajib, modal siap hilang, kalkulator exposure, "sinyal harus valid") itu BUKAN formalitas -- itu justru inti dari kenapa sistem ini punya peluang berhasil.

## 4. Seasonality BTC — temuan sendiri (data lokal)

Dari `web/data/btc-history.json` (2015-2026, data harian):

- **Bulan Agustus historis BEARISH:** dari 11 Agustus penuh (2015-2025), **8 merah (73%), cuma 3 hijau.** Rata-rata Agustus merah turun ~-10%.
- 2017 adalah outlier ekstrem (+64%, rezim bull market beda total) yang narik rata-rata hijau ke atas -- JANGAN anggap representatif buat kondisi normal.
- Sampel 11 tahun itu KECIL secara statistik -- pola ini indikasi/konteks tambahan, BUKAN aturan pasti. Selalu gabung sama konfirmasi teknikal real-time, jangan andalkan musiman doang.

## 5. Prinsip kerja Kaela di Nyopet Market (aturan proyek, WAJIB diikuti)

- **Selalu ada alasan** di tiap angka (entry/TP/SL/level) -- jelasin dari mana asalnya, jangan cuma lempar angka.
- **Konfirmasi candle WAJIB** sebelum order dianggap valid -- breakout butuh CLOSE (bukan wick doang), fade/rejection butuh wick+close dalam 1 candle yang sama.
- **Sabar tunggu setup terbaik** -- jangan paksa bikin Rencana cuma karena "giliran analisa hari ini".
- **Long dan short dua-duanya boleh** -- arah dari struktur pasar, bukan preferensi pribadi.
- **Sinyal harus valid** -- Rencana (pending) TIDAK PERNAH tampil publik (WA/web) sampai beneran ketrigger.
- **Aturan resiko RESMI (8 Agu 2026, filosofi Olan): "modal kecil paksa brutal, makin kaya makin safety".**
  Sizing SELALU lewat `getExposure(modal)` di [kalkulator.html](../web/kalkulator.html) -- gak pernah nembak modal manual
  di luar hasil kalkulator. Fungsi ini otomatis potong separuh exposure tiap modal naik 10x (magnitude desimal),
  jadi resiko riil per trade (margin/modal, di SL 1%) turun sendiri dari ~12% (modal $1-9) sampai <1% (modal
  $10rb+) tanpa perlu tabel manual terpisah. Di modal $1.000+ resiko-nya mendarat ~1,5% -- pas ketemu sama aturan
  "max 1-2% resiko/trade" yang dipakai trader legend (Market Wizards, lihat bagian 1) -- jadi kalkulator kita
  sudah otomatis konvergen ke standar profesional pas modal cukup besar, dan sengaja lebih agresif di modal kecil
  karena kerugian nominalnya belum berarti, butuh dorongan buat compounding awal.

---
*Dokumen ini bagian dari proyek Kaela BTC Sinyal (`D:\KAELA PROJECT\★ KAELA TRADING ENGINE ★\`). Backup juga ke GitHub biar gak hilang kalau folder lokal kenapa-kenapa.*
