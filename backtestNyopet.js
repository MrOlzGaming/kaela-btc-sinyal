// Backtest walk-forward strategi Nyopet Auto-Analysis (breakout daily + konfirmasi Weekly)
// pakai data historis BTCUSDT Binance. TUJUAN: cek beneran ada edge statistik apa nggak,
// bukan cuma "kedengeran masuk akal". Tool diagnostik manual (run langsung, BUKAN dipanggil
// workflow) -- laporan buat Olan review dulu, BUKAN auto-posting ke grup manapun.
//
// CATATAN JUJUR soal beda backtest ini vs live nyopetAutoAnalysis.js (biar gak disalahpahami
// sebagai replay 1:1 baris-demi-baris):
// 1. Live pakai swing zone dari candle HOURLY (96 candle/4 hari) buat resistance/support.
//    Backtest ini pakai swing zone dari candle DAILY (lookback ~90 hari) -- nyimpen histori
//    hourly bertahun-tahun butuh ribuan request paginated ke Binance, gak worth buat validasi
//    konsep. Level DAILY malah lebih signifikan/gak senoisy level hourly, jadi ini pendekatan
//    yang WAJAR, bukan disederhanain sampai gak representatif.
// 2. Live cek TP/SL tembus pakai candle HOURLY (presisi jam). Backtest ini pakai candle DAILY
//    High/Low (presisi hari) -- kalau TP & SL ke-touch di hari yang sama, SL menang (konservatif,
//    sama aturan kayak live).
// 3. Live entry di harga PASAR real-time saat dicek. Backtest entry di harga CLOSE candle harian
//    breakout itu sendiri (proxy wajar, karena di live juga baru dicek abis candle harian closed).
// 4. Hasil dilaporkan dalam R-multiple (risk unit), BUKAN dolar/persen modal -- biar independen
//    dari exposure/leverage yang beda-beda tiap orang, murni ngukur KUALITAS SINYAL.

const { fetchWithRetry } = require('./httpRetry');
const { sma, findSwingPoints, clusterLevels } = require('./technicalAnalysis');

const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';

function parseCandle(raw) {
  return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] };
}

async function fetchAllCandles(symbol, interval, startTime) {
  let all = [];
  let cursor = startTime;
  for (;;) {
    const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`);
    const raw = await res.json();
    if (!raw.length) break;
    all = all.concat(raw.map(parseCandle));
    if (raw.length < 1000) break;
    cursor = raw[raw.length - 1][6] + 1;
  }
  return all;
}

function findNextZone(zones, entryPrice, direction) {
  const candidates = direction === 'buy'
    ? zones.filter((z) => z.price > entryPrice).sort((a, b) => a.price - b.price)
    : zones.filter((z) => z.price < entryPrice).sort((a, b) => b.price - a.price);
  return candidates[0] || null;
}

function computeWeeklyTrendAt(weeklyCandles, asOfMs) {
  const closes = weeklyCandles.filter((c) => c.closeTime <= asOfMs).map((c) => c.close);
  const ma10 = sma(closes, 10);
  const ma30 = sma(closes, 30);
  if (!ma10 || !ma30) return null;
  return ma10 > ma30 ? 'bullish' : ma10 < ma30 ? 'bearish' : 'netral';
}

function runBacktest(dailyCandles, weeklyCandles, opts = {}) {
  const {
    useWeeklyFilter = true, swingLookbackDays = 90, swingPointLookback = 3, warmupDays = 220,
  } = opts;
  const trades = [];
  let openPos = null;

  for (let i = warmupDays; i < dailyCandles.length; i++) {
    const today = dailyCandles[i];

    if (openPos) {
      const hitTp = openPos.direction === 'buy' ? today.high >= openPos.tp : today.low <= openPos.tp;
      const hitSl = openPos.direction === 'buy' ? today.low <= openPos.sl : today.high >= openPos.sl;
      if (hitSl) {
        trades.push({ ...openPos, exitIdx: i, exitPrice: openPos.sl, exitReason: 'SL', rMultiple: -1, exitTime: today.closeTime });
        openPos = null;
      } else if (hitTp) {
        const risk = Math.abs(openPos.entryPrice - openPos.sl);
        const reward = Math.abs(openPos.tp - openPos.entryPrice);
        trades.push({ ...openPos, exitIdx: i, exitPrice: openPos.tp, exitReason: 'TP', rMultiple: risk > 0 ? reward / risk : 0, exitTime: today.closeTime });
        openPos = null;
      }
      continue;
    }

    const dailyCloses = dailyCandles.slice(0, i + 1).map((c) => c.close);
    const ma200 = sma(dailyCloses, 200);
    if (!ma200) continue;

    // PENTING: zona dibentuk dari data SAMPAI KEMARIN (i-1), BUKAN termasuk candle hari ini --
    // kalau ikut candle hari ini, zona "resistance" pasti kebentuk DI ATAS harga close hari ini
    // by construction (definisi filter `price > lastPrice`), jadi breakout jadi mustahil terjadi
    // secara logis (self-referential). Ini juga lebih benar buat walk-forward: keputusan breakout
    // HARI INI wajib berbasis zona yang udah diketahui SEBELUM candle hari ini closed (no lookahead).
    const priorIdx = i - 1;
    const window = dailyCandles.slice(Math.max(0, priorIdx - swingLookbackDays), priorIdx + 1);
    const { highs, lows } = findSwingPoints(window, swingPointLookback);
    const priorPrice = dailyCandles[priorIdx].close;
    const resistanceZones = clusterLevels(highs.filter((h) => h.price > priorPrice), 0.4);
    const supportZones = clusterLevels(lows.filter((l) => l.price < priorPrice), 0.4);
    const topResistance = resistanceZones[0];
    const topSupport = supportZones[0];
    const lastPrice = today.close;

    const weeklyTrend = useWeeklyFilter ? computeWeeklyTrendAt(weeklyCandles, today.closeTime) : null;

    let direction = null;
    if (topResistance && today.close > topResistance.priceMax) {
      if (!(useWeeklyFilter && weeklyTrend === 'bearish')) direction = 'buy';
    } else if (topSupport && today.close < topSupport.priceMin) {
      if (!(useWeeklyFilter && weeklyTrend === 'bullish')) direction = 'sell';
    }
    if (!direction) continue;

    const swingSource = direction === 'buy' ? supportZones : resistanceZones;
    if (!swingSource[0]) continue;
    const sl = swingSource[0].price;

    const oppositeZones = direction === 'buy' ? resistanceZones : supportZones;
    const nextZone = findNextZone(oppositeZones, lastPrice, direction);
    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const tp = nextZone ? nextZone.price : (direction === 'buy' ? lastPrice + riskDistance : lastPrice - riskDistance);

    openPos = { direction, entryIdx: i, entryPrice: lastPrice, sl, tp, entryTime: today.closeTime };
  }

  return trades;
}

function summarize(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0 };
  const wins = trades.filter((t) => t.rMultiple > 0);
  const losses = trades.filter((t) => t.rMultiple <= 0);
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0);
  const grossWinR = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLossR = Math.abs(losses.reduce((s, t) => s + t.rMultiple, 0));
  let maxConsecLoss = 0, curConsecLoss = 0;
  for (const t of trades) {
    if (t.rMultiple <= 0) { curConsecLoss++; maxConsecLoss = Math.max(maxConsecLoss, curConsecLoss); } else curConsecLoss = 0;
  }
  const buy = trades.filter((t) => t.direction === 'buy');
  const sell = trades.filter((t) => t.direction === 'sell');
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / n * 100).toFixed(1) + '%',
    avgR: (totalR / n).toFixed(2),
    profitFactor: grossLossR > 0 ? (grossWinR / grossLossR).toFixed(2) : 'inf',
    totalR: totalR.toFixed(2),
    maxConsecLoss,
    buyCount: buy.length,
    buyWinRate: buy.length ? (buy.filter((t) => t.rMultiple > 0).length / buy.length * 100).toFixed(1) + '%' : '-',
    sellCount: sell.length,
    sellWinRate: sell.length ? (sell.filter((t) => t.rMultiple > 0).length / sell.length * 100).toFixed(1) + '%' : '-',
  };
}

async function main() {
  console.log('Ambil histori candle BTCUSDT dari Binance (daily+weekly, dari listing 2017)...');
  const startTime = new Date('2017-08-17').getTime();
  const [daily, weekly] = await Promise.all([
    fetchAllCandles('BTCUSDT', '1d', startTime),
    fetchAllCandles('BTCUSDT', '1w', startTime),
  ]);
  console.log(`Daily candles: ${daily.length}, Weekly candles: ${weekly.length}`);

  const withFilter = runBacktest(daily, weekly, { useWeeklyFilter: true });
  const withoutFilter = runBacktest(daily, weekly, { useWeeklyFilter: false });

  console.log('\n=== DENGAN filter Weekly (strategi SEKARANG) ===');
  console.log(JSON.stringify(summarize(withFilter), null, 2));
  console.log('\n=== TANPA filter Weekly (breakout polos, buat perbandingan) ===');
  console.log(JSON.stringify(summarize(withoutFilter), null, 2));

  return { withFilter, withoutFilter, daily, weekly };
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR backtestNyopet.js:', e.message); process.exit(1); });
}

module.exports = { runBacktest, summarize, fetchAllCandles, computeWeeklyTrendAt };
