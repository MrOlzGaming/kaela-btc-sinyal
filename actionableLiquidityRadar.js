// actionableLiquidityRadar.js -- Fase 1 (21 Sep 2026, permintaan Olan: filosofi "forced-flow /
// liquidity analyst" -- "jangan tanya BTC bakal ke mana, tanya uang siapa yang paling rentan
// dipaksa bergerak"). MURNI RADAR INFO -- BUKAN sinyal entry, Kaela GAK BUKA POSISI dari ini,
// PRINSIP SAMA PERSIS squeezeDetector.js.
//
// Menjawab "gimana caranya kita dapat info yang LIVE?" -- gabungin 3 sumber REAL (BUKAN model/
// tebakan kayak "liquidation heatmap" yang dijual CoinGlass dkk -- itu ESTIMASI dari OI+asumsi
// leverage, bukan data posisi asli):
//   1. HISTORI cluster (liquidation-heatmap.json, ditulis liquidationListener.js sejak 13 Sep) --
//      "level mana yang DULU rame numpuk", BUKAN snapshot posisi terbuka SEKARANG -- itu emang
//      gak ada sumbernya di manapun, gratis atau berbayar (privat exchange, gak pernah publik).
//   2. CROWDING SEKARANG (marketSentiment.js -- funding rate, Open Interest, long/short ratio,
//      Binance top-trader-vs-global -- SEMUA live, resmi, gratis).
//   3. FORCED-FLOW REAL-TIME (liquidation-events.jsonl, filter window terakhir -- liquidation yang
//      BENERAN kejadian barusan, bukan histori lama).
//
// Trigger: KALAU ada burst liquidation (>=$300rb 1 sisi) dalam 30 menit terakhir -- itu tanda
// forced-flow LAGI kejadian, radar lapor konteksnya (harga, cluster historis terdekat di arah
// yang sama, crowding sekarang). Threshold ini TITIK AWAL (belum divalidasi backtest, status SAMA
// kayak OI_RISE_THRESHOLD_PCT squeezeDetector.js) -- worth ditinjau ulang begitu keliatan seberapa
// sering nembak di praktiknya.
//
// ⛔ FASE 1 doang -- info WA, BELUM masuk archive.json/kategori dashboard/Anomaly Scanner. Sesuai
// aturan proyek ("ide baru wajib backtest dulu" -- SYSTEM-MAP.md Aturan Besi #5 -- + "belajar
// dulu bukan langsung ke sistem" per komentar liquidationListener.js), tahap berikutnya (Fase 2:
// kumpulin histori respons harga di sekitar burst kayak gini, Fase 3: backtest bener, BARU masuk
// Anomaly Scanner) NUNGGU keputusan Olan dari hasil Fase 1 ini jalan beberapa waktu.

const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('./httpRetry');
const { sendWhatsApp } = require('./fonnte');
const { analyzeSentiment } = require('./marketSentiment');

const HEATMAP_PATH = path.join(__dirname, 'liquidation-heatmap.json');
const RAW_LOG_PATH = path.join(__dirname, 'liquidation-events.jsonl');
const STATE_PATH = path.join(__dirname, 'actionable-liquidity-state.json');
const SYMBOL = 'BTCUSDT';

const RECENT_WINDOW_MS = 30 * 60 * 1000; // 30 menit -- window "forced-flow lagi kejadian"
const BURST_THRESHOLD_USD = 300000; // titik awal, BELUM divalidasi -- lihat catatan atas
// Lebih PENDEK dari cooldown squeezeDetector.js (24 jam) -- burst liquidation natural-nya lebih
// SERING & lebih CEPAT berlalu drpd setup squeeze OI/funding yang bisa nahan berhari-hari.
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 jam

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastAlertSide: null, lastAlertAt: null };
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { lastAlertSide: null, lastAlertAt: null }; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

async function fetchLivePrice() {
  const res = await fetchWithRetry(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${SYMBOL}`);
  return parseFloat((await res.json()).price);
}

function loadHeatmap() {
  if (!fs.existsSync(HEATMAP_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(HEATMAP_PATH, 'utf8'))[SYMBOL] || {}; } catch { return {}; }
}

// Baca N baris TERAKHIR file JSONL (bukan seluruh file -- raw log bisa puluhan ribu baris) --
// cukup buat nyakup RECENT_WINDOW_MS asal event gak lagi SUPER padat (>2000 event/30menit, jarang
// banget kejadian bahkan pas market rame -- histori 8 hari baseline-nya ~10 event/jam).
function readRecentEvents(windowMs, now = Date.now()) {
  if (!fs.existsSync(RAW_LOG_PATH)) return [];
  const lines = fs.readFileSync(RAW_LOG_PATH, 'utf8').split('\n').filter(Boolean).slice(-2000);
  const cutoff = now - windowMs;
  return lines
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.symbol === SYMBOL && e.timestamp >= cutoff);
}

// Pure function biar gampang ditest -- ringkas event jadi total notional per sisi.
// side 'SELL' = LONG kena force-close (tekanan harga TURUN). side 'BUY' = SHORT kena force-close
// (tekanan harga NAIK) -- konvensi SAMA PERSIS liquidationListener.js recordLiquidation().
function summarizeEvents(events) {
  let longUsd = 0, shortUsd = 0, longCount = 0, shortCount = 0;
  for (const e of events) {
    const notional = e.price * e.qty;
    if (e.side === 'SELL') { longUsd += notional; longCount++; }
    else { shortUsd += notional; shortCount++; }
  }
  return { longUsd, shortUsd, longCount, shortCount };
}

// Cari cluster historis di 1 SISI harga (di atas ATAU di bawah currentPrice), diurut dari yang
// PALING DEKAT ke currentPrice dulu (bukan yang paling BESAR) -- relevansi JARAK lebih penting
// drpd ukuran buat "apa yang bakal ketemu duluan kalau harga jalan ke arah situ".
function nearbyClusters(heatmap, currentPrice, direction, field, limit = 3) {
  const buckets = Object.keys(heatmap)
    .map((k) => ({ price: Number(k), usd: heatmap[k][field] || 0 }))
    .filter((b) => b.usd > 0 && (direction === 'above' ? b.price > currentPrice : b.price < currentPrice));
  buckets.sort((a, b) => (direction === 'above' ? a.price - b.price : b.price - a.price));
  return buckets.slice(0, limit);
}

function fmtUsd(n) { return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }); }

function formatAlert({ price, burst, clustersSameDirection, sentiment }) {
  const isShortBurst = burst.shortUsd > burst.longUsd; // short-burst = harga lagi NAIK (short kepaksa beli)
  const dirLabel = isShortBurst ? 'NAIK (short kepaksa beli balik)' : 'TURUN (long kepaksa jual paksa)';
  const burstUsd = isShortBurst ? burst.shortUsd : burst.longUsd;
  const burstCount = isShortBurst ? burst.shortCount : burst.longCount;
  const clusterLabel = isShortBurst ? 'SHORT' : 'LONG';

  const lines = [
    '🟣 ⚠️ KAELA -- FORCED-FLOW TERDETEKSI (BTC)',
    '',
    `Harga lagi ${dirLabel} -- ${fmtUsd(burstUsd)} posisi ${clusterLabel} kena likuidasi paksa dalam 30 menit terakhir (${burstCount} event, data real Bybit).`,
    `Harga sekarang: $${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
    '',
  ];

  if (clustersSameDirection.length) {
    lines.push(`📍 Zona historis "${clusterLabel.toLowerCase()}-crowded" terdekat di arah yang sama (data 8+ hari terakhir, BUKAN posisi terbuka sekarang -- cuma nunjukin level yang DULU rame):`);
    clustersSameDirection.forEach((c) => lines.push(`  $${c.price.toLocaleString('en-US')} -- pernah ${fmtUsd(c.usd)} kelikuidasi di sini`));
    lines.push('');
  } else {
    lines.push('📍 Belum ada zona historis tercatat di arah ini (data masih numpuk sejak 13 Sep 2026, atau harga masuk wilayah baru).', '');
  }

  if (sentiment.funding) lines.push(`Funding rate: ${(sentiment.funding.rate * 100).toFixed(4)}% (${sentiment.funding.rate > 0 ? 'long bayar short -- long lebih crowded' : 'short bayar long -- short lebih crowded'})`);
  if (sentiment.openInterest) lines.push(`Open Interest: ${sentiment.openInterest.openInterest.toLocaleString('en-US', { maximumFractionDigits: 0 })} BTC`);
  if (sentiment.binancePositioning) {
    const bp = sentiment.binancePositioning;
    lines.push(`Top Trader vs Global: ${bp.topLongPct.toFixed(0)}% long (top trader) vs ${bp.globalLongPct.toFixed(0)}% long (global/retail)`);
  }

  lines.push(
    '',
    '⚠️ Ini RADAR FASE 1 (belum divalidasi backtest) -- MURNI info forced-flow yang lagi kejadian + konteks historis, BUKAN sinyal entry. Kaela gak buka posisi dari ini.',
    '',
    '— Kaela',
  );
  return lines.join('\n');
}

async function main() {
  const events = readRecentEvents(RECENT_WINDOW_MS);
  const burst = summarizeEvents(events);
  const dominant = Math.max(burst.longUsd, burst.shortUsd);
  if (dominant < BURST_THRESHOLD_USD) {
    console.log(`[ActionableLiquidityRadar] Belum ada burst signifikan (long ${fmtUsd(burst.longUsd)}, short ${fmtUsd(burst.shortUsd)} dalam ${RECENT_WINDOW_MS / 60000} menit terakhir) -- skip.`);
    return;
  }

  const side = burst.shortUsd > burst.longUsd ? 'short' : 'long';
  const state = loadState();
  const now = Date.now();
  if (state.lastAlertSide === side && state.lastAlertAt && now - new Date(state.lastAlertAt).getTime() < COOLDOWN_MS) {
    console.log(`[ActionableLiquidityRadar] Burst ${side} masih dalam cooldown -- skip.`);
    return;
  }

  const [price, sentiment] = await Promise.all([fetchLivePrice(), analyzeSentiment()]);
  const heatmap = loadHeatmap();
  // Short-burst = harga lagi NAIK -> cluster relevan berikutnya ada DI ATAS harga sekarang (short
  // lain yang mungkin ikut kepanggang kalau harga terus naik). Long-burst = harga lagi TURUN ->
  // cluster relevan ada DI BAWAH.
  const clustersSameDirection = nearbyClusters(heatmap, price, side === 'short' ? 'above' : 'below', side === 'short' ? 'shortLiquidatedUsd' : 'longLiquidatedUsd');

  const msg = formatAlert({ price, burst, clustersSameDirection, sentiment });
  console.log(msg);
  await sendWhatsApp(msg); // broadcast biasa -- Sniper Club + Wibowo Hedgefund (Aturan Besi #4 SYSTEM-MAP.md)
  saveState({ lastAlertSide: side, lastAlertAt: new Date(now).toISOString() });
}

module.exports = { main, summarizeEvents, nearbyClusters, readRecentEvents, BURST_THRESHOLD_USD, RECENT_WINDOW_MS, COOLDOWN_MS };
if (require.main === module) { main().catch((e) => console.log('[ActionableLiquidityRadar] ERROR:', e.message)); }
