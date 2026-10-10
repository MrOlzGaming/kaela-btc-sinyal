# PROGRESS — Kaela Trader (baca ini DULUAN tiap chat baru)

> Catatan "baru aja kerjain apa", biar chat baru langsung nyambung TANPA baca ulang chat lama.
> Aturan: entri terbaru di ATAS, maksimal ±15 entri (yang lama dihapus, detailnya udah ada di git/memori).
> Detail lain: strategi → `STRATEGY-CATALOG.md`, nunggu/antrian → `GANTUNGAN.md`, trade → `TRADE-LEDGER.md`.

## 🎯 SEKARANG LAGI DI MANA

- **Topik aktif:** Grid ATH BTC-USDC (BingX Perpetual REAL, `gridTrader.js`)
- **Status:** LIVE, nunggu saldo USDC masuk (BTC ±−34% dari ATH $126.199)
- **Pertanyaan terbuka ke Olan:** "minimal cap" maksudnya yang mana?
  - A = porsi dihitung dari `max(modal asli, modal patokan minimal)` → rebuy tetap tiap 1%, efeknya kayak leverage selama modal < patokan
  - B = ukuran order minimal per tangga (misal $10), jatah bisa habis sebelum harga turun sampai bawah
  - C = modal minimal buat mulai, grid nunggu sampai saldo ≥ X
- **Langkah berikutnya:** Olan jawab A/B/C (+ angka) → ubah `gridTrader.js` + `grid-config.json` → commit

## 📜 LOG (terbaru di atas)

- **10 Okt 22:xx WITA** — Chat KAELA (TRADER) mentok kuota (7.529 pesan). Bikin sistem irit: file PROGRESS.md ini + aturan
  handoff ke chat baru. Chat TRADER lama dipensiunin.
- **10 Okt** — Grid: modal nyicil, top up kebaca otomatis dan porsi dikejar seolah modal udah ada dari awal (commit 57d7f019).
  Olan minta "minimal cap" (lihat pertanyaan terbuka).
- **9 Okt 23:20** — Grid ATH LIVE REAL (commit 506209be). DCA Tangga batal.

## 📋 PESAN SIAP COPY-PASTE KE CHAT BARU

```
Kaela, lanjut kerjaan Trader. Baca dulu PROGRESS.md di ★ KAELA TRADING ENGINE ★ (bagian "SEKARANG LAGI DI MANA"),
terus lanjutin dari situ. Jangan baca ulang chat lama.
```
