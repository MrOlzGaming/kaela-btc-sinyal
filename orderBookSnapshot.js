// orderBookSnapshot.js -- ide #2 (13 Sep 2026, "pantau order book / dinding likuiditas BTC").
// Snapshot berkala depth order book BTCUSDT (Binance Futures, publik+gratis, gak butuh API key)
// -- cari "dinding" (order gede numpuk di 1 level harga dibanding sekitarnya). Cocok sama tema
// "mikir kayak bandar" (feedback-market-maker-mindset) -- dinding likuiditas sering nunjukin di
// mana pemain besar naruh order gede (support/resistance BUATAN, bukan cuma teknikal biasa).
//
// ⚠️ JUJUR soal batasnya: ini snapshot POINT-IN-TIME, order BESAR bisa "spoofing" (dipasang lalu
// dicabut sebelum kesentuh, taktik umum manipulasi) -- SATU snapshot gak bisa bedain dinding ASLI
// vs spoofing, butuh BANYAK snapshot dari waktu ke waktu buat liat pola (dinding yang PERSISTEN
// beda dari yang keluar-masuk cepat). Itu alasan ini didesain buat numpuk data dulu, BUKAN sinyal
// langsung.
//
// ⛔ MURNI ARSIP -- gak pernah pengaruhi sinyal/eksekusi trading apapun.

const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('./httpRetry');

const LOG_PATH = path.join(__dirname, 'orderbook-wall-research-log.json');
const DEPTH_URL = 'https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=500';
const MAX_ENTRIES = 20000; // ~beberapa bulan snapshot 15-menitan (~5-10 dinding/snapshot rata2)

// Ambang "dinding": notional (price*qty) level itu WAJIB (a) di atas minimum absolut (biar gak
// nangkep noise pas market lagi sepi total) DAN (b) beberapa kali lipat median level lain di sisi
// yang sama (biar relatif terhadap kondisi pasar SAAT itu, bukan angka tetap yang bisa keliru di
// kondisi ekstrem).
const MIN_NOTIONAL_USD = 500000; // $500rb -- level di bawah ini gak dianggap "dinding" apapun kondisinya
const MULTIPLIER_VS_MEDIAN = 5; // minimal 5x median level lain buat dianggap menonjol

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function findWalls(levels, side, midPrice) {
  // levels = [[priceStr, qtyStr], ...] dari Binance
  const notionals = levels.map(([p, q]) => parseFloat(p) * parseFloat(q));
  const med = median(notionals);
  const walls = [];
  for (let i = 0; i < levels.length; i++) {
    const price = parseFloat(levels[i][0]);
    const qty = parseFloat(levels[i][1]);
    const notionalUsd = price * qty;
    if (notionalUsd < MIN_NOTIONAL_USD) continue;
    if (med > 0 && notionalUsd < med * MULTIPLIER_VS_MEDIAN) continue;
    const distPct = ((price - midPrice) / midPrice) * 100;
    walls.push({ side, price, qty, notionalUsd, distPct });
  }
  return walls;
}

function loadLog() {
  if (!fs.existsSync(LOG_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return []; }
}
function saveLog(arr) {
  fs.writeFileSync(LOG_PATH, arr.length > MAX_ENTRIES ? JSON.stringify(arr.slice(-MAX_ENTRIES), null, 2) : JSON.stringify(arr, null, 2));
}

async function main() {
  const res = await fetchWithRetry(DEPTH_URL);
  const data = await res.json();
  const bids = data.bids || []; // [[price, qty], ...] tertinggi dulu
  const asks = data.asks || []; // terendah dulu
  if (!bids.length || !asks.length) { console.log('[OrderBookSnapshot] Order book kosong/gagal, skip.'); return; }

  const midPrice = (parseFloat(bids[0][0]) + parseFloat(asks[0][0])) / 2;
  const wallsBid = findWalls(bids, 'BID', midPrice); // dinding BELI = support buatan
  const wallsAsk = findWalls(asks, 'ASK', midPrice); // dinding JUAL = resistance buatan
  const allWalls = [...wallsBid, ...wallsAsk];

  const log = loadLog();
  const timestamp = new Date().toISOString();
  for (const w of allWalls) {
    log.push({ timestamp, midPrice, ...w });
  }
  saveLog(log);

  if (allWalls.length) {
    const summary = allWalls
      .sort((a, b) => b.notionalUsd - a.notionalUsd)
      .slice(0, 3)
      .map((w) => `${w.side} $${w.price.toFixed(0)} (${w.distPct >= 0 ? '+' : ''}${w.distPct.toFixed(2)}%, $${(w.notionalUsd / 1e6).toFixed(2)}jt)`)
      .join(' | ');
    console.log(`[OrderBookSnapshot] ${allWalls.length} dinding ketemu (mid $${midPrice.toFixed(0)}) -- top 3: ${summary}`);
  } else {
    console.log(`[OrderBookSnapshot] Gak ada dinding menonjol siklus ini (mid $${midPrice.toFixed(0)}).`);
  }
}

module.exports = { main, findWalls, median };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR orderBookSnapshot.js:', e.message); process.exit(1); });
}
