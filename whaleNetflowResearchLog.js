// whaleNetflowResearchLog.js -- arsip riset "exchange netflow" harian (12 Sep 2026, permintaan
// Olan lanjutan upgrade whale alert: "gabungin ke teknikal makin gacor").
//
// KONTEKS PENTING: exchange netflow SEBAGAI SINYAL TRADING udah PERNAH dites dulu dan GAGAL
// (lihat "Riset yang SUDAH SELESAI dieksplorasi" di project-kaela-btc-sinyal.md -- "exchange
// netflow on-chain: dites, BELUM ngalahin baseline"). TAPI riset lama itu kemungkinan pakai data
// atribusi yang JAUH lebih lemah drpd sekarang (exchangeAddresses.js SEKARANG pakai WalletExplorer,
// jutaan alamat vs 6 dulu) -- worth DICOBA ULANG dengan data baru ini, TAPI butuh histori numpuk
// dulu beberapa bulan sebelum backtest yang jujur bisa dilakuin (sample kecil = kesimpulan gak
// bisa dipercaya, SAMA disiplin kayak semua riset lain di proyek ini).
//
// Dipanggil whaleDailyDigest.js SETELAH digest harian kelar dihitung. Append-only, MURNI LOKAL
// (state runtime, regeneratable dari re-scan blockchain kalau perlu -- gitignored).
//
// ⛔ INI CUMA ARSIP -- gak pernah pengaruhi sinyal/eksekusi trading apapun. Backtest beneran
// (kalau datanya udah cukup numpuk) WAJIB dilaporin+minta izin Olan dulu sebelum diterapkan ke
// sistem live, sama kayak semua riset lain.

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'whale-netflow-research-log.json');
// 13 Sep 2026: bucket 4-jam TERPISAH dari log harian di atas -- resolusi nyamain candle Nyopet
// (4H), biar pas datanya udah cukup numpuk buat backtest, granularitasnya bisa dites di 2 timeframe
// (harian buat Sniper, 4H buat Nyopet) tanpa API call tambahan (numpang blok yang sama).
const BUCKET_LOG_PATH = path.join(__dirname, 'whale-netflow-4h-research-log.json');

function loadAll() {
  if (!fs.existsSync(LOG_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return []; }
}
function saveAll(arr) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(arr, null, 2));
}

// `btcPriceUsd` -- harga BTC PAS digest ini dihitung (bukan harga di masa depan, itu belum
// kejadian). Buat backtest NANTI (join sama histori harga harian beneran, mis. via
// backtest/fetchKlines.js), BUKAN dihitung di sini -- logging cuma nyatet apa yang KETAHUAN saat
// itu, analisa "apa yang terjadi setelahnya" dikerjain belakangan pas datanya udah cukup.
function recordDailyNetflow({ dateKey, totalBtc, count, toExchangeBtc, fromExchangeBtc, btcPriceUsd }) {
  const arr = loadAll();
  if (arr.some((e) => e.dateKey === dateKey)) return; // udah kecatet hari ini, jangan dobel
  arr.push({
    dateKey,
    recordedAt: new Date().toISOString(),
    totalBtc, count, toExchangeBtc, fromExchangeBtc,
    netFlowBtc: fromExchangeBtc - toExchangeBtc, // POSITIF = net KELUAR exchange (akumulasi), NEGATIF = net MASUK (potensi jual)
    btcPriceUsd,
  });
  saveAll(arr);
}

function loadBuckets() {
  if (!fs.existsSync(BUCKET_LOG_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(BUCKET_LOG_PATH, 'utf8')); } catch { return []; }
}
function saveBuckets(arr) {
  fs.writeFileSync(BUCKET_LOG_PATH, JSON.stringify(arr, null, 2));
}

// Dipanggil TIAP RUN whaleDailyDigest.js (bukan cuma 1x/hari) dengan data BATCH blok yang baru
// diproses run ini -- merge/tambah ke bucket 4H yang sama kalau udah ada entry-nya, biar 1 hari
// = 6 baris (bukan numpuk per-run). `btcPriceUsd` ditimpa ke harga PALING BARU tiap merge (bukan
// rata-rata) -- cukup buat konteks kasar, presisi penuh nanti join histori harga asli pas backtest.
function recordNetflowBucket({ bucketKey, totalBtc, count, toExchangeBtc, fromExchangeBtc, btcPriceUsd }) {
  const arr = loadBuckets();
  let entry = arr.find((e) => e.bucketKey === bucketKey);
  if (!entry) {
    entry = { bucketKey, totalBtc: 0, count: 0, toExchangeBtc: 0, fromExchangeBtc: 0 };
    arr.push(entry);
  }
  entry.totalBtc += totalBtc;
  entry.count += count;
  entry.toExchangeBtc += toExchangeBtc;
  entry.fromExchangeBtc += fromExchangeBtc;
  entry.netFlowBtc = entry.fromExchangeBtc - entry.toExchangeBtc;
  entry.btcPriceUsd = btcPriceUsd;
  entry.updatedAt = new Date().toISOString();
  saveBuckets(arr);
}

module.exports = { recordDailyNetflow, loadAll, LOG_PATH, recordNetflowBucket, loadBuckets, BUCKET_LOG_PATH };
