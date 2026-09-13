# 🐛 BUG_REGISTRY.md — Kaela BTC Sinyal

Catatan formal bug NYATA yang ketemu+fix di sistem ini -- diadaptasi dari pola **P-14 Bug
Registry** punya `NEXUS-FORGE` (`D:\KAELA PROJECT\NEXUS-FORGE\`, kerangka tim-AI Olan yang selama
ini jalan manual lintas sesi chat terpisah). Di sini disederhanakan buat konteks 1 sesi
terus-menerus (Claude Code) -- gak pakai dispatch/banner/role-switch, cuma bagian yang beneran
kepake: **1 baris = 1 bug, gampang dicari, gak nyebar di prosa memori**.

Kenapa dibikin (13 Sep 2026): bug KRITIS tranId-dedup (lihat BUG-KAELATRADE-0001) mencemari data
9 hari sebelum ketauan, dan sebelum ini gak ada satupun tempat terpusat buat liat "bug apa aja
yang pernah kejadian di sini, akar masalahnya apa, udah beneran ketutup apa belum". Riwayatnya
ada, tapi nyebar di comment file + memori Claude -- registry ini SATU tempat ringkas, git-tracked,
kebaca siapapun (termasuk sesi Claude baru) tanpa harus baca ulang seluruh histori chat.

**Format**: `BUG-KAELATRADE-[NNNN]` (nomor urut, gak pernah dipakai ulang walau bug lama dihapus
dari daftar aktif -- diarsipkan di bawah, bukan dihapus).

## Aktif / Baru Ditutup

| ID | Tanggal | Ringkasan | Root Cause | Fix (commit) | Regression Test | Status |
|----|---------|-----------|-------------|---------------|------------------|--------|
| BUG-KAELATRADE-0001 | 2026-09-13 | **KRITIS** — "PnL hari ini" salah total (Binance app +$12,96, sistem bilang -$1,89) | `tradeHistoryStore.js` dedup pakai `id: String(tranId)` polos — Binance kasih `tranId` SAMA buat `REALIZED_PNL` + `COMMISSION` dari 1 fill, entry COMMISSION (selalu muncul belakangan di response) NIMPA REALIZED_PNL. Mencemari data sejak file dibuat (4 Sep) — 9 hari. Bug IDENTIK ditemukan independen di `multiAccountExecutor.js` (implementasi sync terpisah, sebelum dikonsolidasi) | `44baaa2` (tradeHistoryStore.js), `e451509` (multiAccountExecutor.js, URGENT — nyaris re-korup data yang baru direbuild) | `regressionTests.js` (test #1-3, ground truth `+12.96136192`) | ✅ CLOSED |
| BUG-KAELATRADE-0002 | 2026-09-08 | Whale-scan cuma proses ~8/144 blok/hari, backlog numpuk (~211 blok/1,5 hari) | `whaleDailyDigest.js` gerbang scan blok DI BELAKANG `hasEntryToday('whale-daily')` (cek "udah kirim WA hari ini?") — scan blok baru jalan kalau BELUM kirim WA, padahal WA cuma 1x/hari | `2a6e955` — scan didekopel dari gerbang kirim-WA, jalan tiap cycle | — (belum ada, kandidat solusi #3 lanjutan) | ✅ CLOSED |
| BUG-KAELATRADE-0003 | 2026-09-13 | Pesan posisi (tambah/tutup) ke grup Wibowo Hedgefund hilang PERMANEN kalau cek toggle broadcast gagal | `kaelaProTraderClient.js` `getWibowoBroadcastEnabled()` — kalau GAS check-nya gagal/timeout (bukan gagal KIRIM, gagal CEK IZIN kirim), pesan dianggap "gak boleh kirim" dan dibuang, TANPA retry | `9b92735` (fix awal), `518d901` (antrean retry `wibowo-broadcast-queue.json`, khusus utk kegagalan CEK, beda dari retry-safety `fonnte.js` yang udah ada utk kegagalan KIRIM) | — | ✅ CLOSED |

## Diarsipkan (superseded / gak relevan lagi)

_(kosong)_

## Cara Pakai

- **Bug baru ketemu**: tambah baris ke tabel "Aktif" -- ID naik urut, isi Root Cause SEJUJUR
  mungkin (termasuk kalau kita sendiri gak yakin 100% akar masalahnya), commit fix begitu ada.
- **Kalau bug ini juga perlu dilaporkan ke Olan/grup via WA** (kayak koreksi PnL 13 Sep) -- ikutin
  tetap [[feedback-wa-send-approval]] (draft + approval dulu), TAPI tutup pesannya dengan TTD role
  (13 Sep 2026, konsep NEXUS-FORGE): `— Kaela` baris baru `(laporan: 🐉 Drake · Debug Specialist)`.
  Kaela TETAP satu2nya pengirim -- ini co-signature nunjukin jenis laporan, bukan ganti identitas.
- **Bug tanpa regression test**: kolom "Regression Test" boleh `—` dulu, tapi kalau bug itu
  KRITIS (uang/data salah), prioritaskan tambahin test ke `regressionTests.js` (lihat pola
  BUG-KAELATRADE-0001 sbg contoh: fixture data + assert pakai ANGKA GROUND TRUTH dari insiden
  nyata, bukan angka rekaan).
- **JANGAN hapus baris** walau bug-nya udah lama/gak relevan lagi -- pindah ke bagian "Diarsipkan"
  kalau memang superseded (misal fitur yang kena bug udah dihapus total), biar histori tetap utuh.
