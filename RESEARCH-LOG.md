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

- Indikator makro lain sebagai konfirmasi entry (COT report positioning, funding rate BTC,
  Fear&Greed Index level, korelasi DXY-Emas terpisah dari DXY-BTC)
- Parameter sweep lookback window Nyopet v2 (saat ini di-rescale ×6 dari tuning harian ke 4H
  — belum pernah divalidasi ulang secara independen apakah ×6 itu optimal)
- Parameter sweep exit rule (partial 50% di 2R + trailing SMA60 — kenapa 2R dan SMA60
  spesifik itu, apa ada kombinasi lain yang lebih robust di split-era test)
- Filter volatilitas (skip entry kalau ATR/volatility terlalu rendah/tinggi dari rata-rata)
- Time-of-day / day-of-week filter untuk Nyopet 4H (apa ada sesi tertentu yang secara
  konsisten lebih/kurang reliable)
