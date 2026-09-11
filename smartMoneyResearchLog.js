// smartMoneyResearchLog.js -- arsip riset KONTINU posisi smart-money (12 Sep 2026, permintaan
// Olan: "kamu juga boleh buka posisi seolah kamu whale nya" -- otomatis LONG kalau ada divergensi
// aneh). BLOCKER: Binance cuma nyimpen histori long/short ratio ~30 HARI (dites langsung 12 Sep --
// data mentok di 12 Agustus) -- GAK CUKUP buat validasi ketat kayak yang dipake NFP (butuh
// tahunan). Jadi SEBELUM sinyal ini boleh auto-trading, kita HARUS numpuk histori kita SENDIRI
// dulu -- sama filosofi kayak squeezeDetector.js dulu (OKX gak sediain histori OI publik, jadi
// nyimpen snapshot sendiri tiap run).
//
// Dipanggil smartMoneyDivergenceMonitor.js TIAP SIKLUS (15 menit), REGARDLESS ada anomali/nggak --
// beda dari WA alert yang cuma nge-gate pas ekstrem, arsip riset ini butuh titik data TERUS-MENERUS
// (termasuk kondisi "normal") biar nanti backtest bisa liat FORWARD RETURN dari SEMUA kondisi, bukan
// cuma dari momen "aneh"-nya doang.
//
// ⛔ MURNI ARSIP -- gak pernah pengaruhi eksekusi trading apapun. Begitu histori numpuk cukup
// (target minimal beberapa BULAN, idealnya >100 kejadian divergensi buat sample yang layak
// dipercaya -- SAMA standar kayak NFP n=72 dulu), WAJIB divalidasi pakai metodologi ketat yang
// SAMA (backtest/backtestValidation.js: permutation test + Deflated Sharpe + Ulcer Index) SEBELUM
// dipertimbangkan buat auto-trading beneran -- laporan dulu ke Olan, minta izin dulu.

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'smart-money-research-log.json');
const MAX_ENTRIES = 100000; // ~beberapa tahun data 15-menitan, cap jaga-jaga biar file gak infinite

function loadAll() {
  if (!fs.existsSync(LOG_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return []; }
}

function recordSnapshot({ countLongPct, dollarLongPct, globalLongPct, gap, type, btcPrice }) {
  const arr = loadAll();
  arr.push({
    timestamp: new Date().toISOString(),
    countLongPct, dollarLongPct, globalLongPct, gap, type, btcPrice,
  });
  fs.writeFileSync(LOG_PATH, JSON.stringify(arr.slice(-MAX_ENTRIES), null, 2));
}

module.exports = { recordSnapshot, loadAll, LOG_PATH };
