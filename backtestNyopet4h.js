// Simulasi Nyopet versi 4-JAM (10 Agu 2026, ide baru Olan setelah riset harian mentok):
// - Konfirmasi breakout per CANDLE 4 JAM (bukan harian lagi) -- lebih sering, manfaatin
//   volatilitas jangka pendek, bukan nunggu candle harian yang jarang closed valid.
// - Nyawa/SL KETAT: fixed 2-3% dari titik breakout (BUKAN zona struktur kayak versi harian --
//   di skala 4 jam, struktur emang jauh lebih rapat, jadi nyawa ketat ini WAJAR, beda dari nyawa
//   ketat di skala HARIAN yang kemarin terbukti bikin sistem kelaparan sinyal).
// - Filter trend: DAILY (bukan Weekly lagi) -- satu level di atas entry 4H, rasio sama kayak
//   desain lama (entry harian -> filter mingguan).
// - TP tetap ADAPTIF (nyesuaiin kekuatan momentum Daily), exposure via hitungFixedRisk (scalable,
//   1 posisi di satu waktu dulu -- multi-posisi belum tervalidasi menang, lihat riset sebelumnya).
// - INVALID = tunggu sinyal berikutnya (gak ada perubahan dari desain lama).

const { fetchWithRetry } = require('./httpRetry');
const { sma, findSwingPoints, clusterLevels } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');

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

function pickNearestSl(zones, entryPrice, direction) {
  const candidates = direction === 'buy'
    ? zones.filter((z) => z.price < entryPrice).sort((a, b) => b.price - a.price)
    : zones.filter((z) => z.price > entryPrice).sort((a, b) => a.price - b.price);
  return candidates[0] || null;
}

function pickAdaptiveTp(zones, entryPrice, riskDistance, direction, minRR) {
  const candidates = direction === 'buy'
    ? zones.filter((z) => z.price > entryPrice).sort((a, b) => a.price - b.price)
    : zones.filter((z) => z.price < entryPrice).sort((a, b) => b.price - a.price);
  for (const z of candidates) {
    const reward = Math.abs(z.price - entryPrice);
    if (reward / riskDistance >= minRR) return z;
  }
  return null;
}

function classifyStrength(momentumPct) {
  if (momentumPct === null || momentumPct === undefined) return 'lemah';
  if (momentumPct < 10) return 'lemah';
  if (momentumPct < 20) return 'sedang';
  return 'kuat';
}
const MIN_RR_BY_STRENGTH = { lemah: 1.0, sedang: 1.5, kuat: 2.0 };

// Trend DAILY (MA10 vs MA30 harian) sebagai berikut ke atas 4H -- ganti dari Weekly (yang buat
// entry harian), rasio proporsional sama desain lama.
function computeDailyStatsAt(dailyCandles, asOfMs) {
  const closes = dailyCandles.filter((c) => c.closeTime <= asOfMs).map((c) => c.close);
  const ma10 = sma(closes, 10);
  const ma30 = sma(closes, 30);
  if (!ma10 || !ma30) return { trend: null, momentumPct: null };
  const trend = ma10 > ma30 ? 'bullish' : ma10 < ma30 ? 'bearish' : 'netral';
  const momentumPct = Math.abs((ma10 - ma30) / ma30) * 100;
  return { trend, momentumPct };
}

function runBacktest4h(candles4h, dailyCandles, opts = {}) {
  const {
    slPct = 0.025, swingLookback4h = 240, swingPointLookback = 3, warmupBars = 1800, // ~300 hari 4H, cukup buat MA200 harian + swing
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpIntervalDays = 30,
    useDailyFilter = true, sizingMode = 'exposure', targetRiskPct = 15,
  } = opts;

  const trades = [];
  let openPos = null;
  let capital = startCapital;
  let toppedUpStopped = capital >= topUpStopAt;
  let lastTopUpTime = candles4h[warmupBars] ? candles4h[warmupBars].closeTime : 0;
  let peakCapital = startCapital;
  const capitalSeries = [{ time: lastTopUpTime, capital }];

  for (let i = warmupBars; i < candles4h.length; i++) {
    const bar = candles4h[i];

    if (!toppedUpStopped && bar.closeTime - lastTopUpTime >= topUpIntervalDays * 86400000) {
      capital += topUpAmount;
      lastTopUpTime = bar.closeTime;
      if (capital >= topUpStopAt) toppedUpStopped = true;
      capitalSeries.push({ time: bar.closeTime, capital });
    }

    if (openPos) {
      const hitTp = openPos.direction === 'buy' ? bar.high >= openPos.tp : bar.low <= openPos.tp;
      const hitSl = openPos.direction === 'buy' ? bar.low <= openPos.sl : bar.high >= openPos.sl;
      if (hitSl) {
        capital = Math.max(0, capital - openPos.lossAtSl);
        trades.push({ ...openPos, exitIdx: i, exitPrice: openPos.sl, exitReason: 'SL', rMultiple: -1, pnlUsd: -openPos.lossAtSl, exitTime: bar.closeTime, capitalAfter: capital });
        capitalSeries.push({ time: bar.closeTime, capital });
        openPos = null;
      } else if (hitTp) {
        const rewardPct = Math.abs(openPos.tp - openPos.entryPrice) / openPos.entryPrice * 100;
        const profitUsd = openPos.nilaiPosisi * (rewardPct / 100);
        capital += profitUsd;
        const risk = Math.abs(openPos.entryPrice - openPos.sl);
        const reward = Math.abs(openPos.tp - openPos.entryPrice);
        trades.push({ ...openPos, exitIdx: i, exitPrice: openPos.tp, exitReason: 'TP', rMultiple: risk > 0 ? reward / risk : 0, pnlUsd: profitUsd, exitTime: bar.closeTime, capitalAfter: capital });
        capitalSeries.push({ time: bar.closeTime, capital });
        openPos = null;
      }
      peakCapital = Math.max(peakCapital, capital);
      continue;
    }

    // Zona dari 4H SEBELUMNYA (no lookahead), window swingLookback4h bar ke belakang.
    const priorIdx = i - 1;
    const window = candles4h.slice(Math.max(0, priorIdx - swingLookback4h), priorIdx + 1);
    const { highs, lows } = findSwingPoints(window, swingPointLookback);
    const priorPrice = candles4h[priorIdx].close;
    const resistanceZones = clusterLevels(highs.filter((h) => h.price > priorPrice), 0.4);
    const supportZones = clusterLevels(lows.filter((l) => l.price < priorPrice), 0.4);
    const topResistance = resistanceZones[0];
    const topSupport = supportZones[0];
    const lastPrice = bar.close;

    const dailyStats = useDailyFilter ? computeDailyStatsAt(dailyCandles, bar.closeTime) : { trend: null, momentumPct: null };

    let direction = null;
    if (topResistance && bar.close > topResistance.priceMax) {
      if (!(useDailyFilter && dailyStats.trend === 'bearish')) direction = 'buy';
    } else if (topSupport && bar.close < topSupport.priceMin) {
      if (!(useDailyFilter && dailyStats.trend === 'bullish')) direction = 'sell';
    }
    if (!direction) continue;

    // Nyawa KETAT fixed slPct dari titik breakout (BUKAN zona struktur).
    const sl = direction === 'buy' ? lastPrice * (1 - slPct) : lastPrice * (1 + slPct);
    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;

    const oppositeZones = direction === 'buy' ? resistanceZones : supportZones;
    const strength = classifyStrength(dailyStats.momentumPct);
    const minRR = MIN_RR_BY_STRENGTH[strength];
    const adaptiveZone = pickAdaptiveTp(oppositeZones, lastPrice, riskDistance, direction, minRR);
    const tp = adaptiveZone ? adaptiveZone.price : (direction === 'buy' ? lastPrice + riskDistance * minRR : lastPrice - riskDistance * minRR);
    if (tp <= 0) continue;

    // Sizing: 'exposure' (kalkulator ASLI, calculator.js hitungExposure -- BUG ketemu 10 Agu 2026,
    // ditegur Olan: sebelumnya di sini dipakai rumus fixedRisk custom yang GAK PEDULI lebar nyawa,
    // padahal hitungExposure udah diimport tapi gak dipakai) ATAU 'fixedRisk' (margin dikunci %
    // dari modal, sama pola kayak sistem harian -- buat perbandingan resiko yang terkendali).
    const nyawaPct = slPct * 100;
    let nilaiPosisi, leverage, margin;
    if (sizingMode === 'fixedRisk') {
      leverage = Math.max(1, Math.floor(100 / nyawaPct));
      margin = capital * (targetRiskPct / 100);
      nilaiPosisi = margin * leverage;
    } else {
      ({ nilaiPosisi, leverage, margin } = hitungExposure({ modal: capital, nyawa: nyawaPct }));
    }
    if (margin > capital) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);

    openPos = {
      direction, entryIdx: i, entryPrice: lastPrice, sl, tp, entryTime: bar.closeTime,
      capitalAtEntry: capital, nilaiPosisi, leverage, margin, lossAtSl, dailyTrend: dailyStats.trend, dailyStrength: strength,
    };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) {
    peak = Math.max(peak, pt.capital);
    maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100);
  }

  return { trades, finalCapital: capital, maxDrawdownPct, capitalSeries };
}

function summarize(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0 };
  const wins = trades.filter((t) => t.rMultiple > 0);
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0);
  const grossWinR = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLossR = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((s, t) => s + t.rMultiple, 0));
  return {
    n, wins: wins.length, losses: n - wins.length,
    winRate: (wins.length / n * 100).toFixed(1) + '%',
    avgR: (totalR / n).toFixed(2),
    profitFactor: grossLossR > 0 ? (grossWinR / grossLossR).toFixed(2) : 'inf',
    totalR: totalR.toFixed(2),
  };
}

async function main() {
  console.log('Ambil histori candle 4H + Daily BTCUSDT dari Binance...');
  const startTime = new Date('2017-08-17').getTime();
  const [candles4h, dailyCandles] = await Promise.all([
    fetchAllCandles('BTCUSDT', '4h', startTime),
    fetchAllCandles('BTCUSDT', '1d', startTime),
  ]);
  console.log(`4H candles: ${candles4h.length}, Daily candles: ${dailyCandles.length}`);

  for (const slPct of [0.02, 0.025, 0.03, 0.04, 0.05, 0.07, 0.10, 0.15]) {
    const r = runBacktest4h(candles4h, dailyCandles, { slPct });
    const s = summarize(r.trades);
    console.log(`nyawa=${(slPct * 100).toFixed(1)}%`.padEnd(12), 'n='+String(s.n).padEnd(4), 'winRate='+String(s.winRate||'-').padEnd(7), 'profitFactor='+String(s.profitFactor||'-').padEnd(6), 'final=$'+r.finalCapital.toFixed(2).padEnd(12), 'DD='+r.maxDrawdownPct.toFixed(1)+'%');
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR backtestNyopet4h.js:', e.message, e.stack); process.exit(1); });
}

module.exports = { runBacktest4h, summarize, fetchAllCandles };
