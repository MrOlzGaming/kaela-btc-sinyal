// backtestNyopetChannelBreakoutFeeCheck.js (22 Sep 2026) -- Olan: "profit factor lebih bagus,
// trading fee ga begitu masalah kan? kan tradingnya pake kalkulator exposure, ga mungkin all-in?"
// Ini itungan HONEST buat jawab itu: "gak all-in" (Exposure Calculator bracket table) itu soal
// PORSI MODAL TOTAL yang masuk 1 trade -- TIDAK sama dengan "fee gak masalah". Fee (Binance
// futures taker) dipotong dari NOTIONAL (nilaiPosisi = margin x leverage), BUKAN dari margin.
// Sistem sizing ini SENGAJA pakai leverage tinggi (leverage = 100/nyawa%, cap 50x, calculator.js)
// biar SL via likuidasi presisi -- makin SEMPIT channel 5-menitnya (nyawa% kecil), makin TINGGI
// leverage-nya, makin BESAR fee relatif ke margin (= relatif ke "1R"). Jadi biarpun modal total
// aman (gak all-in), fee bisa tetap gigit BESAR per-trade kalau leverage-nya tinggi -- dua hal
// yang terpisah, harus dicek numeriknya sendiri-sendiri, bukan diasumsikan.
//
// Metode: reuse fee round-trip 0,10% (taker+taker kasar) -- angka SAMA yang udah dipakai riset
// sejenis sebelumnya (backtest/rsiOversoldBounceScalp5m.js, biar konsisten, bukan angka baru
// sembarangan). Per trade: leverage = min(MAX_LEVERAGE, floor(100/nyawaPct)) dari nyawaPct =
// halfWidth/entryPrice x 100 (SAMA formula yang beneran dipakai live, calculator.js). Fee dalam
// satuan R (krn "1R" = margin penuh by design) = leverage x feeRoundTripPct/100. netR = r - feeR.

const { fetchWithRetry } = require('./httpRetry');
const { simulateBreakoutOnly } = require('./backtestNyopetChannelBreakoutOnly');
const { simulateBreakoutTrailingPct } = require('./backtestNyopetChannelBreakoutTrailing');
const { metricProfitFactor } = require('./backtest/backtestValidation');
const { MAX_LEVERAGE } = require('./calculator');

const ROUND_TRIP_COST_PCT = 0.10; // taker+taker kasar -- SAMA angka yang dipakai rsiOversoldBounceScalp5m.js

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
  }
  return all;
}

function winRate(returns) { return returns.length ? returns.filter((r) => r > 0).length / returns.length : null; }
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

function feeAdjust(trades, detail) {
  const nyawaPcts = [];
  const leverages = [];
  const netTrades = trades.map((r, idx) => {
    const d = detail[idx];
    const halfWidth = d.halfWidth !== undefined ? d.halfWidth : Math.abs(d.entryPrice - d.sl); // breakout-only detail belum expose halfWidth langsung, turunin dari sl
    const nyawaPct = (halfWidth / d.entryPrice) * 100;
    const leverage = Math.max(1, Math.min(MAX_LEVERAGE, Math.floor(100 / nyawaPct)));
    const feeR = leverage * (ROUND_TRIP_COST_PCT / 100);
    nyawaPcts.push(nyawaPct);
    leverages.push(leverage);
    return r - feeR;
  });
  return { netTrades, nyawaPcts, leverages };
}

async function main() {
  const years = 2;
  const endTime = Date.now();
  const startTime = endTime - years * 365 * 24 * 60 * 60 * 1000;
  console.log(`[FeeCheck] Fetch BTCUSDT 5m, ${years} tahun terakhir...`);
  const candles = await fetchAllCandles('BTCUSDT', '5m', startTime, endTime);
  console.log(`[FeeCheck] ${candles.length} candle kefetch.\n`);
  console.log(`Asumsi fee round-trip: ${ROUND_TRIP_COST_PCT}% dari notional (taker+taker kasar), leverage cap ${MAX_LEVERAGE}x.\n`);

  // === TP TETAP ===
  const tradesTP = simulateBreakoutOnly(candles);
  const detailTP = simulateBreakoutOnly._lastDetail;
  const { netTrades: netTP, nyawaPcts: nyawaTP, leverages: levTP } = feeAdjust(tradesTP, detailTP);
  console.log('=== TP TETAP (breakout-only) ===');
  console.log(`GROSS: n=${tradesTP.length}, win=${(winRate(tradesTP) * 100).toFixed(1)}%, totalR=${tradesTP.reduce((a, b) => a + b, 0).toFixed(1)}, PF=${metricProfitFactor(tradesTP).toFixed(2)}`);
  console.log(`NET (fee-adjusted): totalR=${netTP.reduce((a, b) => a + b, 0).toFixed(1)}, PF=${metricProfitFactor(netTP).toFixed(2)}, winRate(net>0)=${(winRate(netTP) * 100).toFixed(1)}%`);
  console.log(`nyawa% (SL distance): median=${median(nyawaTP).toFixed(3)}%, mean=${mean(nyawaTP).toFixed(3)}%`);
  console.log(`leverage terpakai: median=${median(levTP).toFixed(0)}x, mean=${mean(levTP).toFixed(1)}x, %trade kena cap ${MAX_LEVERAGE}x=${(levTP.filter((l) => l === MAX_LEVERAGE).length / levTP.length * 100).toFixed(1)}%`);
  console.log(`Fee rata-rata per trade: ${mean(levTP.map((l) => l * (ROUND_TRIP_COST_PCT / 100))).toFixed(3)}R\n`);

  // === TRAILING % ===
  const tradesTrail = simulateBreakoutTrailingPct(candles);
  const detailTrail = simulateBreakoutTrailingPct._lastDetail;
  const { netTrades: netTrail, nyawaPcts: nyawaTrail, leverages: levTrail } = feeAdjust(tradesTrail, detailTrail);
  console.log('=== TRAILING % ===');
  console.log(`GROSS: n=${tradesTrail.length}, win=${(winRate(tradesTrail) * 100).toFixed(1)}%, totalR=${tradesTrail.reduce((a, b) => a + b, 0).toFixed(1)}, PF=${metricProfitFactor(tradesTrail).toFixed(2)}`);
  console.log(`NET (fee-adjusted): totalR=${netTrail.reduce((a, b) => a + b, 0).toFixed(1)}, PF=${metricProfitFactor(netTrail).toFixed(2)}, winRate(net>0)=${(winRate(netTrail) * 100).toFixed(1)}%`);
  console.log(`nyawa% (SL distance): median=${median(nyawaTrail).toFixed(3)}%, mean=${mean(nyawaTrail).toFixed(3)}%`);
  console.log(`leverage terpakai: median=${median(levTrail).toFixed(0)}x, mean=${mean(levTrail).toFixed(1)}x, %trade kena cap ${MAX_LEVERAGE}x=${(levTrail.filter((l) => l === MAX_LEVERAGE).length / levTrail.length * 100).toFixed(1)}%`);
  console.log(`Fee rata-rata per trade: ${mean(levTrail.map((l) => l * (ROUND_TRIP_COST_PCT / 100))).toFixed(3)}R`);
}

if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
