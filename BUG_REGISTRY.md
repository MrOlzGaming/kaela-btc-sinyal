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
| BUG-KAELATRADE-0004 | 2026-09-13 | Pesan "Tutup Posisi (gak ke-track)" NUDUH "kemungkinan besar manual trading" sbg satu-satunya dugaan, padahal histori bug proyek ini (insiden 3/8/12 Sep) nunjukin penyebab SAMA MUNGKINNYA (bahkan lebih sering) adalah mesin eksekutor pindah leader (journal lokal gak ke-sync, `multi-account-state/` sengaja gak lewat git) — bisa nyalahin Olan buat hal yang bukan aksinya | `formatAutoClosedUntracked` (`darkKaelaLog.js`) nulis kalimat sebab-akibat pasti padahal sistem gak pernah beneran tau mana dari 2 kemungkinan yang kejadian | `e1cd589` | — | ✅ CLOSED |
| BUG-KAELATRADE-0005a | 2026-09-14 | **KRITIS** — `run-vultr-executor.sh` skip TOTAL 10 siklus berturut-turut (6+ jam, 19:32-02:00 WITA), NOL siklus 15-menit jalan. Ketauan dari GEJALA gak langsung: Olan lapor "PnL Harian 0%" di web (data pool gak ke-update, bukan pasar diem) | ⚠️ DIAGNOSIS AWAL SALAH — dikira `node` script HANG (18/26 panggilan emang gak ada `timeout`, itu tetap dibenerin sbg hardening, TAPI itu BUKAN sebab insiden ini spesifik). Root cause ASLI: `run-position-check-fast.sh` (tiap 5 menit) & `run-vultr-executor.sh` (tiap 15 menit) BERBAGI lock yang SAMA by design (nulis state file yang sama) — crontab `*/5` bikin script 5-menitan PERSIS nembak di menit :00/:15/:30/:45, SAMA kayak yang 15-menitan. Karena preamble-nya jauh lebih pendek (langsung ke `flock`, gak ada git-sync/heartbeat dulu), script 5-menitan SELALU menang rebutan lock -- yang 15-menitan KALAH TERUS di SETIAP siklus, bukan sesekali. `positionCheckFast.js` SENDIRI terbukti sehat (log jalan mulus tanpa jeda) -- itu yang bikin `lsof`/`ps aux` gak pernah nemu proses "nyangkut" pas dicek manual (emang gak ada yang hang beneran) | `5a90110` (hardening timeout, tetap berguna buat hang GENUINE ke depan, plus `checkExecutorStuck.js` pengawas) + crontab `run-position-check-fast.sh` digeser `*/5`→`1-59/5` (gak pernah lagi ketemu :00/:15/:30/:45) -- fix SEBENARNYA buat insiden spesifik ini, didokumentasikan di komentar `run-position-check-fast.sh` biar redeploy VPS ke depan gak balik ke `*/5` lagi | `regressionTests.js` (test `detectStuck`, tapi TES ITU nguji gejala/deteksi, BUKAN root cause scheduling race -- belum ada test buat race ini sendiri) | ✅ CLOSED |

| BUG-KAELATRADE-0006 | 2026-09-14 | **KRITIS** — `mexcExecutor.js` `placeMarketEntry` gagal TOTAL ("Leverage multiplier must be within the upper limit 100 and lower limit 1") -- MEXC nolak SEMUA order buka posisi | Endpoint `order/create` MEXC TERNYATA wajib field `leverage` eksplisit di body, beda dari Binance yang cukup diset sekali via endpoint terpisah (`change_leverage`) dan otomatis kepake buat order berikutnya. `mexcExecutor.js` gak pernah nyertain field ini -- BELUM PERNAH KETAUAN karena integrasi ini emang belum pernah dites pakai API key beneran sebelum hari ini (30 Agu 2026 ditulis dari dokumentasi doang) | `92f13b9` — cache leverage TERAKHIR yang diset per symbol (dari `setLeverage`), otomatis disertain `placeMarketEntry` -- interface caller (Sniper/Nyopet) TETAP SAMA, gak perlu ubah | Manual (tes live, belum ada regression test otomatis -- perlu mock HTTP MEXC dulu) | ✅ CLOSED |
| BUG-KAELATRADE-0007 | 2026-09-14 | **KRITIS/BAHAYA** — `emergencyCloseMarket`+`placeStopLoss`+`placeTakeProfit` MEXC pakai kode arah TERBALIK (`closeSide`) -- tutup posisi LONG gagal "Position is nonexistent or closed". Kalau gak ketemu, SEMUA posisi Emas MEXC auto-trading bakal kebuka TANPA Stop Loss/Take Profit sama sekali (SL/TP-nya pasti ditolak MEXC dengan pola bug yang sama) | Kode side MEXC: 2=close SHORT, 4=close LONG (dikonfirmasi dokumentasi) -- versi lama nulis `direction==='buy' ? 2 : 4` (PERSIS TERBALIK). Ini SEBELUMNYA cuma "CATATAN belum diverifikasi, TODO cek pas ada API key" di komentar kode -- gak pernah beneran dites sampai hari ini | `92f13b9` — dibalik jadi `direction==='buy' ? 4 : 2` di ketiga fungsi. Diverifikasi LANGSUNG: tutup LONG sukses, buka SHORT+pasang SL/TP sukses (dikonfirmasi via app MEXC Olan -- "Open Orders(2)" muncul, sebelumnya bakal 0/error) | Manual (tes live) | ✅ CLOSED |
| BUG-KAELATRADE-0008 | 2026-09-14 | Pesan posisi manual (Buka/Tutup/Add/Reduce/Flip/HiddenActivity) buat symbol MEXC bakal nampilin ticker MENTAH exchange (`PAXG_USDC`/`XAUT_USDT`) ke grup Wibowo Hedgefund -- pelanggaran aturan lama [[feedback-ticker-nama-literal]] ("Emas JANGAN literal token MEXC, Olan bingung"). Ketauan+dibenerin SEBELUM pesan salah sempat kekirim (untung siklus deteksinya kena skip lock beberapa kali duluan) | `positionReconciler.js` SENGAJA didesain "gak kenal" symbol (biar asset APAPUN yang Olan trading manual tetap kelaporan) -- desain itu benar, TAPI efek sampingnya symbol MENTAH ikut kebawa ke pesan tanpa di-translate ke label yang biasa dilihat Olan | `92f13b9` — lookup KECIL simbol->label dari asset config Sniper+Nyopet yang UDAH ADA (`nyopetAssetConfig.js`/`assetConfig.js`), symbol yang BENERAN gak dikenal (asset di luar BTC/Emas) tetap tampil apa adanya, desain awal ("asset apapun") gak rusak | Manual (tes live, render preview `formatManualOpen` dicek manual sebelum+sesudah fix) | ✅ CLOSED |

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
