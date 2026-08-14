// Dark Kaela -- mesin deteksi zona likuiditas, SATU sumber kebenaran dipakai backtest
// (backtest/darkKaelaLiquidity.js) MAUPUN live (darkKaelaMonitor.js), gak ada logika dobel
// (pola sama kayak chartPatterns.js buat Sniper). Lihat KNOWLEDGE/memory project-dark-kaela
// buat konteks lengkap desain & hasil riset.
//
// Zona likuiditas = proxy TEKNIKAL (BUKAN data likuidasi asli -- dicek 15 Agu 2026, Binance
// diam-diam nahan data broadcast ke IP cloud, koneksi WS jalan tapi 0 pesan diterima):
// swing high/low signifikan (findSwingPoints/clusterLevels, REUSE dari technicalAnalysis.js,
// fungsi sama persis dipakai Sniper) + angka bulat psikologis.

const { findSwingPoints, clusterLevels } = require('./technicalAnalysis');

// Parameter default (dari riset backtest/darkKaelaLiquidity.js, 15 Agu 2026) -- near% yang paling
// ngaruh dari semua yang dites, titik awal near=0,5% touches>=2 (bounce rate ~58%, blm dramatis
// tapi di atas 50-50, realistis buat gaya risk-tinggi ini).
const DEFAULT_PARAMS = {
  SWING_LOOKBACK: 3,
  CLUSTER_TOLERANCE_PCT: 0.4,
  ZONE_WINDOW_CANDLES: 24 * 14, // 14 hari candle jam-an
  MIN_TOUCHES: 2,
  NEAR_PCT: 0.5,
  BREAK_CONFIRM_PCT: 0.3,
};

function roundNumberStep(price) {
  if (price < 5000) return 250;
  if (price < 20000) return 1000;
  if (price < 100000) return 5000;
  return 10000;
}

function nearestRoundLevels(price) {
  const step = roundNumberStep(price);
  const below = Math.floor(price / step) * step;
  const above = below + step;
  return [below, above].filter((v) => v > 0);
}

function pctDist(a, b) {
  return Math.abs(a - b) / b * 100;
}

// candles: array {open,high,low,close,closeTime}, urut kronologis. i: index candle "sekarang"
// (zona dihitung dari candle SEBELUM i doang -- no lookahead, sama prinsip kayak backtest).
function detectZones(candles, i, params = DEFAULT_PARAMS) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const start = Math.max(0, i - p.ZONE_WINDOW_CANDLES);
  const window = candles.slice(start, i);
  if (window.length < p.SWING_LOOKBACK * 4) return { resistance: [], support: [] };
  const price = candles[i].close;
  const { highs, lows } = findSwingPoints(window, p.SWING_LOOKBACK);
  const resistance = clusterLevels(highs.filter((h) => h.price > price), p.CLUSTER_TOLERANCE_PCT)
    .filter((z) => z.touches >= p.MIN_TOUCHES)
    .map((z) => ({ price: z.price, touches: z.touches, kind: 'swing' }));
  const support = clusterLevels(lows.filter((l) => l.price < price), p.CLUSTER_TOLERANCE_PCT)
    .filter((z) => z.touches >= p.MIN_TOUCHES)
    .map((z) => ({ price: z.price, touches: z.touches, kind: 'swing' }));

  const [roundBelow, roundAbove] = nearestRoundLevels(price);
  if (roundAbove) resistance.push({ price: roundAbove, touches: null, kind: 'round' });
  if (roundBelow) support.push({ price: roundBelow, touches: null, kind: 'round' });

  return { resistance, support };
}

// Cari kandidat sinyal TERDEKAT keseluruhan (gabung support+resistance, SATU pemenang) --
// bug penting yang ketemu di riset: evaluasi 2 arah independen bikin dobel-sinyal tiap candle
// pas harga kebetulan deket support DAN resistance bersamaan. JANGAN balik ke pola itu.
function findNearestCandidate(candle, zones, params = DEFAULT_PARAMS) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const candidates = [
    ...zones.support.map((z) => ({ ...z, direction: 'long', dist: pctDist(candle.low, z.price) })),
    ...zones.resistance.map((z) => ({ ...z, direction: 'short', dist: pctDist(candle.high, z.price) })),
  ].filter((z) => z.dist <= p.NEAR_PCT).sort((a, b) => a.dist - b.dist);
  return candidates[0] || null;
}

// Cek apakah candle CLOSE (bukan wick) beneran ngelewatin zona yang lagi aktif.
function isZoneBroken(candle, activeZone, params = DEFAULT_PARAMS) {
  const p = { ...DEFAULT_PARAMS, ...params };
  if (!activeZone) return false;
  if (activeZone.direction === 'long') return candle.close < activeZone.price * (1 - p.BREAK_CONFIRM_PCT / 100);
  return candle.close > activeZone.price * (1 + p.BREAK_CONFIRM_PCT / 100);
}

module.exports = { DEFAULT_PARAMS, roundNumberStep, nearestRoundLevels, pctDist, detectZones, findNearestCandidate, isZoneBroken };
