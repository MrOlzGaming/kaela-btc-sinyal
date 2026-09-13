// minerPoolResearchLog.js -- arsip riset "distribusi pool tambang per blok" (13 Sep 2026, ide dari
// diskusi "gimana caranya paus/market maker kayak tau duluan" -- miner outflow/selling pressure
// adalah salah satu on-chain signal yang dikenal luas, TAPI versi PENUHNYA butuh clustering wallet
// payout tiap pool [belum dikerjain, tingkat kerjaan sama kayak exchangeAddresses.js dulu]).
//
// LANGKAH 1 (ini): rekap SIAPA yang mining berapa blok per hari -- fondasi gratis, akurat (lihat
// minerPools.js), numpang di blok yang UDAH di-fetch whaleDailyDigest.js. BELUM bisa jawab "miner
// jual/nggak" -- itu perlu tau alamat PAYOUT tiap pool, langkah berikutnya kalau ini kepake.
//
// ⛔ MURNI ARSIP -- gak pernah pengaruhi sinyal/eksekusi trading apapun. MURNI LOKAL (gitignored).

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'miner-pool-research-log.json');

function loadAll() {
  if (!fs.existsSync(LOG_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return []; }
}
function saveAll(arr) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(arr, null, 2));
}

// `poolCounts` = { 'AntPool': 3, 'Foundry USA': 2, null: 1, ... } (null = gak teridentifikasi)
// Merge/tambah ke entry TANGGAL yang sama kalau udah ada (dipanggil tiap run whaleDailyDigest.js).
function recordDailyPoolCounts(dateKey, poolCounts) {
  const arr = loadAll();
  let entry = arr.find((e) => e.dateKey === dateKey);
  if (!entry) {
    entry = { dateKey, poolCounts: {} };
    arr.push(entry);
  }
  for (const [pool, n] of Object.entries(poolCounts)) {
    entry.poolCounts[pool] = (entry.poolCounts[pool] || 0) + n;
  }
  saveAll(arr);
}

module.exports = { recordDailyPoolCounts, loadAll, LOG_PATH };
