# 🗺️ Peta Fungsi 7 Exchange — Kaela Trading Engine

> Dibuat 6 Okt 2026 atas permintaan Olan: "rencanakan fungsi 7 exchange biar kerja semua".
> Prinsip (arahan Olan 3 Okt): **tiap sistem punya exchange sendiri** (gak tumpang tindih), **demo selalu jalan
> (Sniper Club)**, **real pakai saldo asli (Wibowo Hedgefund)**, ukuran posisi dari kalkulator exposure.

## Kondisi sekarang (6 Okt 2026)

| # | Exchange | Dipakai buat | Demo | Real | Saldo real |
|---|---|---|---|---|---|
| 1 | Binance Futures | Sniper BTC (BTCUSDT) + Ranger BTC 3 slot (BTCUSDC) + Fed Dovish Grid + scalp FOMC | testnet (harga melenceng s/d +0,46%) | ON, min 0,001 BTC (~$86/order) | $0 |
| 2 | Binance Spot | DCA spot / Musiman (Compound Alt) | testnet | anggaran $0 | - |
| 3 | MEXC | Emas XAUUSDT (Sniper + Ranger) | gak ada demo Emas di exchange manapun | ON | ada |
| 4 | BingX Perpetual | Ninja MR + Exhaustion + News | ✅ VST | ✅ ON | $15,79 |
| 5 | BingX Standard Futures | DCA Tangga (Olan manual, Kaela mantau) | - | ✅ | 6 posisi $2 x3 |
| 6 | Bybit | Ranger Rotasi 8 koin | ✅ | ✅ ON | $11,17 |
| 7 | Bitget | **NGANGGUR** (key real konek, demo gak ada dana) | - | - | $0,58 |

**Masalah:** (a) Bitget nganggur; (b) Binance Futures dipakai 2 sistem (Sniper + Ranger) -- melanggar prinsip
"exchange sendiri"; (c) minimum order Binance ~$86 bikin real Sniper/Ranger BTC gak bisa jalan pakai modal kecil;
(d) demo Binance testnet harganya melenceng dari pasar asli (hasil demo Ranger BTC gak realistis).

## Rencana

1. **Bitget → Ranger BTC (3 slot: Pola, FVG, ICT Sweep), demo + real.**
   - Minimum Bitget cuma 0,0001 BTC / $5 -> real jalan pakai ~$10-25 (sama kayak Ninja/Rotasi).
   - `bitgetExecutor.js` udah punya entry/close market + posisi + saldo; Ranger BTC dual murni polling (gak butuh
     order SL native) -> paling gampang dipindah duluan.
   - Demo: Bitget Demo Trading punya BTC (`SBTCSUSDT`) tapi saldo demo $0 -> **Olan klaim saldo demo** di app Bitget.
     Kalau gak bisa, demo Ranger BTC tetap di Binance testnet, real-nya aja yang ke Bitget.
   - Bonus: Fed Dovish Grid & scalp FOMC (tetap di Binance BTCUSDC) gak tabrakan/netting lagi sama Ranger.
2. **Binance Futures → Sniper BTC + metode event (Fed Dovish Grid, scalp FOMC).** Gak berubah, cuma lebih lega.
   Real nunggu saldo (min ~$100 USDT buat long, ~$200 buat short).
3. **Binance Spot → DCA/Musiman jangka panjang** (dana yang gak buat trading). Anggaran real diisi Olan kapan pun.
4. **MEXC → Emas** (Sniper + Ranger), real. Demo tetap kertas/simulasi (gak ada exchange yang punya demo Emas).
5. **BingX Perpetual → Ninja** ✅ jalan. **BingX Standard Futures → DCA Tangga** ✅ jalan. **Bybit → Ranger Rotasi** ✅ jalan.
6. **Setoran bulanan** ($100/bln 30/40/20/10) disesuaikan ke dompet yang beneran dipakai (lihat `project-kaela-monthly-funding`).

## Urutan kerja Kaela (setelah Olan OK)
1. Tes Bitget real pakai saldo $0,58: baca saldo/posisi + cek ukuran minimum (BACA doang, gak buka order).
2. Tambah jalur exchange Bitget di `rangerBtcDualExec.js` (config `exchange: bitget` per mode, default tetap Binance),
   selftest + regressionTests, badge pesan 🟢 Bitget, Buku Besar ikut kebaca.
3. Begitu Olan isi saldo Bitget (real) / klaim saldo demo -> nyalain, verifikasi posisi pertama.
4. Update Kaela Access (kartu exchange), SYSTEM-MAP, memori.
