// backtestNyopetChannelBreakoutLongRange.js (22 Sep 2026) -- validasi jangka PANJANG (2 tahun)
// dari backtestNyopetChannelBreakoutOnly.js (TP tetap) + backtestNyopetChannelBreakoutTrailing.js
// (trailing %) -- Olan minta "tarik data panjang" biar gak cuma nangkep 1 musim bagus (120 hari
// awal kebetulan BTC lagi naik terus). WAJIB breakdown PER TAHUN (Aturan Besi SYSTEM-MAP.md #5) --
// angka agregat doang gak cukup, edge yang beneran HARUS konsisten lintas era beda kondisi pasar.

const { fetchWithRetry } = require('./httpRetry');
const { simulateBreakoutOnly } = require('./backtestNyopetChannelBreakoutOnly');
const { simulateBreakoutTrailingPct } = require('./backtestNyopetChannelBreakoutTrailing');
const { metricProfitFactor, barPermutationTest } = require('./backtest/backtestValidation');

const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';
function parseCandle(raw) { return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] }; }
async function fetchAllCandles(symbol, interval, startTime, endTime) {
  let all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=1000`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;
    all = all.concat(raw.map(parseCandle));
    const last = raw[raw.length - 1][6];
    if (last <= cursor) break;
    cursor = last + 1;
    if (all.length % 50000 < 1000) console.log(`  ... ${all.length} candle (${new Date(cursor).toISOString().slice(0, 10)})`);
  }
  return all;
}

function winRate(returns) { return returns.length ? returns.filter((r) => r > 0).length / returns.length : null; }

// Simulasi jalan atas SELURUH rentang candle (biar channel yang lagi tracking pas ganti tahun gak
// keputus paksa), TAPI trade-nya dikelompokin ke tahun kalender SAAT ENTRY (candle.entryTime) --
// perlu versi simulateXxx yang balikin DETAIL (bukan cuma array R) buat breakdown per tahun. Dua
// fungsi yang dipakai sekarang cuma balikin array R polos -- reuse detail exposed dari file asalnya.
function yearOf(ms) { return new Date(ms).getUTCFullYear(); }

async function main() {
  const years = 2;
  const endTime = Date.now();
  const startTime = endTime - years * 365 * 24 * 60 * 60 * 1000;
  console.log(`[LongRange] Fetch BTCUSDT 5m, ${years} tahun terakhir (${new Date(startTime).toISOString().slice(0, 10)} -> ${new Date(endTime).toISOString().slice(0, 10)})...`);
  const candles = await fetchAllCandles('BTCUSDT', '5m', startTime, endTime);
  console.log(`[LongRange] ${candles.length} candle kefetch.\n`);

  for (const [label, simulateFn, detailKey] of [
    ['TP TETAP (breakout-only)', simulateBreakoutOnly, '_lastDetail'],
  ]) {
    const trades = simulateFn(candles);
    const detail = simulateBreakoutOnly._lastDetail;
    console.log(`=== ${label} -- AGREGAT ${years} TAHUN ===`);
    console.log(`Total trade: ${trades.length}, Win rate: ${(winRate(trades) * 100).toFixed(1)}%, Total R: ${trades.reduce((a, b) => a + b, 0).toFixed(1)}, PF: ${metricProfitFactor(trades).toFixed(2)}`);

    const byYear = {};
    detail.forEach((d, idx) => {
      const y = yearOf(d.entryTime);
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push(trades[idx]);
    });
    console.log('Breakdown per tahun:');
    Object.keys(byYear).sort().forEach((y) => {
      const rs = byYear[y];
      console.log(`  ${y}: n=${rs.length}, win=${(winRate(rs) * 100).toFixed(1)}%, totalR=${rs.reduce((a, b) => a + b, 0).toFixed(1)}, PF=${metricProfitFactor(rs).toFixed(2)}`);
    });
    console.log();
  }

  // Trailing % -- fungsi ini gak expose detail per-trade (cuma array R), jadi breakdown per-tahun
  // butuh jalan manual per-tahun (re-slice candle per tahun kalender, jalanin ulang per potongan).
  console.log('=== TRAILING % (breakout+trailing) -- PER TAHUN (re-run per potongan tahun) ===');
  const minYear = new Date(startTime).getUTCFullYear();
  const maxYear = new Date(endTime).getUTCFullYear();
  let aggTrades = [];
  for (let y = minYear; y <= maxYear; y++) {
    const yStart = Math.max(startTime, Date.UTC(y, 0, 1));
    const yEnd = Math.min(endTime, Date.UTC(y + 1, 0, 1));
    if (yStart >= yEnd) continue;
    // Sertain buffer 100 candle SEBELUM tahun ini (biar channel yang lagi kebentuk pas pergantian
    // tahun gak keputus) -- buffer dibuang dari HASIL (cuma dipakai konteks deteksi).
    const bufferStart = Math.max(startTime, yStart - 100 * 5 * 60 * 1000);
    const yCandles = candles.filter((c) => c.openTime >= bufferStart && c.openTime < yEnd);
    if (yCandles.length < 200) continue;
    const rs = simulateBreakoutTrailingPct(yCandles);
    aggTrades = aggTrades.concat(rs);
    console.log(`  ${y}: n=${rs.length}, win=${rs.length ? (winRate(rs) * 100).toFixed(1) : 'n/a'}%, totalR=${rs.reduce((a, b) => a + b, 0).toFixed(1)}, PF=${rs.length ? metricProfitFactor(rs).toFixed(2) : 'n/a'}`);
  }
  console.log(`\nAgregat trailing % ${years} tahun: n=${aggTrades.length}, win=${(winRate(aggTrades) * 100).toFixed(1)}%, totalR=${aggTrades.reduce((a, b) => a + b, 0).toFixed(1)}, PF=${metricProfitFactor(aggTrades).toFixed(2)}`);

  // 50x (bukan 200x kayak versi 120-hari) -- data 6x lebih banyak, tiap iterasi lebih lambat.
  // Breakdown per-tahun di atas udah jadi validasi UTAMA buat "konsisten lintas era" -- ini
  // pelengkap statistik, gak masalah iterasinya lebih dikit.
  console.log('\n=== BAR PERMUTATION TEST -- TP TETAP, full range (50x) ===');
  const perm = barPermutationTest(candles, (c) => simulateBreakoutOnly(c), metricProfitFactor, { iterations: 50 });
  if (perm.ok) {
    console.log(`Observed PF: ${perm.observedMetric.toFixed(2)} (n=${perm.observedTradeCount})`);
    console.log(`Null mean PF: ${perm.nullMean.toFixed(2)} +- ${perm.nullStdDev.toFixed(2)}`);
    console.log(`p-value: ${perm.pValue.toFixed(3)} (< 0.05 = signifikan, bukan kebetulan)`);
  } else {
    console.log('Gagal:', perm.error);
  }
}

if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
