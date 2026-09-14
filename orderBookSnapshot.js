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
const { sendWhatsApp } = require('./fonnte');
const { WIBOWO_GROUP_ID } = require('./wibowoNotify');
const { roleOpener } = require('./teamRoles');

const LOG_PATH = path.join(__dirname, 'orderbook-wall-research-log.json');
// "Aneh" (13 Sep 2026, permintaan Olan: "dinding kalo aneh bisa info darurat?") -- dibandingin ke
// HISTORI KITA SENDIRI (sama filosofi anomalyScanner.js), BUKAN angka tetap sembarangan -- begitu
// data cukup numpuk, dinding dianggap "aneh" kalau >2x dinding TERBESAR yang PERNAH kecatat.
// Sebelum histori cukup (`MIN_HISTORY_FOR_STATS`), pakai jaring pengaman absolut ($5jt) dulu.
const MIN_HISTORY_FOR_STATS = 20;
const HISTORY_MULTIPLIER = 2;
const ABSOLUTE_FALLBACK_USD = 5000000;
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

// Kesimpulan "jika-maka" (13 Sep 2026, permintaan Olan) -- interpretasi SEDERHANA+KONSERVATIF,
// SELALU dikasih syarat "kalau X bertahan" (bukan kepastian) -- sama gaya jujur kayak whaleLog.js
// ("potensi tekanan jual, BUKAN kepastian"). Dinding BISA dicabut/ditembus kapan aja (spoofing).
function interpretWall(wall) {
  const arah = wall.side === 'ASK' ? 'JUAL' : 'BELI';
  const efek = wall.side === 'ASK' ? 'ketahan NAIK (resistance buatan)' : 'ketahan TURUN (support buatan)';
  return `Jika dinding ${arah} ini BERTAHAN (gak ditembus), MAKA harga BTC kemungkinan ${efek} di sekitar $${wall.price.toFixed(0)} -- BUKAN jaminan, dinding order bisa aja dicabut kapan saja (taktik "spoofing" umum).`;
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

  // Info darurat (13 Sep 2026, permintaan Olan) -- "aneh" = dibandingin histori KITA SENDIRI
  // (log SEBELUM entry siklus ini ditambahin), bukan angka tetap. Histori kurang dari
  // MIN_HISTORY_FOR_STATS -> pakai jaring pengaman absolut dulu.
  const priorNotionals = log.slice(0, log.length - allWalls.length).map((e) => e.notionalUsd);
  const historicalMax = priorNotionals.length ? Math.max(...priorNotionals) : 0;
  const threshold = priorNotionals.length >= MIN_HISTORY_FOR_STATS
    ? historicalMax * HISTORY_MULTIPLIER
    : ABSOLUTE_FALLBACK_USD;

  const urgentWalls = allWalls.filter((w) => w.notionalUsd >= threshold);
  if (urgentWalls.length) {
    const biggest = urgentWalls.sort((a, b) => b.notionalUsd - a.notionalUsd)[0];
    const dasarAmbang = priorNotionals.length >= MIN_HISTORY_FOR_STATS
      ? `>2x dinding terbesar yang PERNAH kecatat ($${(historicalMax / 1e6).toFixed(2)}jt)`
      : `>$5jt (histori masih kurang dari ${MIN_HISTORY_FOR_STATS} data, pakai jaring pengaman awal)`;
    const msg = [
      `${roleOpener('REED', 'ada anomali di likuiditas BTC')}`,
      '',
      `${biggest.side} $${biggest.price.toFixed(0)} (${biggest.distPct >= 0 ? '+' : ''}${biggest.distPct.toFixed(2)}% dari harga sekarang $${midPrice.toFixed(0)}) -- ukuran $${(biggest.notionalUsd / 1e6).toFixed(2)}jt.`,
      `Kenapa dianggap anomali: ${dasarAmbang}.`,
      '',
      interpretWall(biggest),
      '',
      '⚠️ Riset awal, BELUM divalidasi -- murni info, bukan ajakan aksi apapun.',
      '',
      // Badge role (15 Sep 2026, dipindah ke OPENER di atas -- lihat teamRoles.js).
      '— Kaela',
    ].join('\n');
    console.log(msg);
    // Ke Wibowo Hedgefund (13 Sep 2026, "jangan DM aku, masuk grup aja") -- LANGSUNG sendWhatsApp
    // (bukan sendWhatsAppToWibowo) sama pola kayak vultrBalanceMonitor.js/exchangeWalletTracker.js:
    // info riset, bukan update posisi, WAJIB tetap nyampe walau toggle Silent Trade lagi OFF.
    await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[OrderBookSnapshot] Gagal kirim info darurat:', e.message));
  }
}

module.exports = { main, findWalls, median };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR orderBookSnapshot.js:', e.message); process.exit(1); });
}
