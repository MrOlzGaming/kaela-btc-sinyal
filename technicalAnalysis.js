// Mesin analisa teknikal -- ngitung level-level LANGSUNG dari angka candle (bukan baca chart/gambar).
// Alasan modul ini ada: TradingView (widget resmi kita maupun akun pribadi Olan) render pakai
// WebGL/canvas -- Kaela gak bisa "lihat" itu lewat screenshot otomatis (dibuktikan 9 Agu 2026: kanvas
// beneran render benar, cuma alat screenshot gak nangkep WebGL). Solusinya BUKAN paksa "lihat" chart,
// tapi ngitung hal yang sama yang manusia liat di chart -- MA, RSI, support/resistance, trendline --
// langsung dari data numerik. Deterministik, bisa diulang, gak tergantung render sama sekali.

const { fetchWithRetry } = require('./httpRetry');

const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';

function parseCandle(raw) {
  return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] };
}

async function fetchCandles(symbol, interval, limit) {
  const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const raw = await res.json();
  return raw.map(parseCandle);
}

// ============ Indikator dasar ============

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ============ Swing point + support/resistance ============
// Swing high/low = titik yang lebih ekstrem dari `lookback` candle di kiri DAN kanannya --
// definisi standar dipakai analis manual, di sini dihitung otomatis, bukan ditebak dari mata.

function findSwingPoints(candles, lookback = 3) {
  const highs = [], lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    const windowSlice = candles.slice(i - lookback, i + lookback + 1);
    if (c.high === Math.max(...windowSlice.map((w) => w.high))) highs.push({ index: i, price: c.high, time: c.closeTime });
    if (c.low === Math.min(...windowSlice.map((w) => w.low))) lows.push({ index: i, price: c.low, time: c.closeTime });
  }
  return { highs, lows };
}

// Cluster swing points yang berdekatan (dalam tolerancePct) jadi 1 ZONA -- makin banyak "sentuhan"
// dalam 1 zona, makin kuat levelnya dianggap (persis logika manual kita: "ditolak 3x" dst).
function clusterLevels(points, tolerancePct = 0.4) {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters = [];
  let current = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prevAvg = current.reduce((s, p) => s + p.price, 0) / current.length;
    if (Math.abs(sorted[i].price - prevAvg) / prevAvg * 100 <= tolerancePct) {
      current.push(sorted[i]);
    } else {
      clusters.push(current);
      current = [sorted[i]];
    }
  }
  clusters.push(current);
  return clusters
    .map((c) => ({
      price: c.reduce((s, p) => s + p.price, 0) / c.length,
      touches: c.length,
      priceMin: Math.min(...c.map((p) => p.price)),
      priceMax: Math.max(...c.map((p) => p.price)),
    }))
    .sort((a, b) => b.touches - a.touches);
}

// ============ Trendline (regresi linear lewat swing points) ============
// Bukan ditarik tangan -- least-squares fit lewat titik-titik swing high (buat resistance turun)
// atau swing low (buat support naik) N candle terakhir.

function fitTrendline(points) {
  if (points.length < 2) return null;
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.index, 0);
  const sumY = points.reduce((s, p) => s + p.price, 0);
  const sumXY = points.reduce((s, p) => s + p.index * p.price, 0);
  const sumX2 = points.reduce((s, p) => s + p.index * p.index, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept, valueAt: (index) => slope * index + intercept };
}

// ============ Analisa lengkap 1 simbol ============

async function analyze(symbol = 'BTCUSDT') {
  const daily = await fetchCandles(symbol, '1d', 220); // cukup buat MA200
  const hourly = await fetchCandles(symbol, '1h', 96); // 4 hari terakhir buat swing pendek
  const weekly = await fetchCandles(symbol, '1w', 60); // ~14 bulan, cukup buat MA30 mingguan

  const dailyCloses = daily.map((c) => c.close);
  const lastPrice = hourly[hourly.length - 1].close;

  // Konfirmasi multi-timeframe (9 Agu 2026): trend Weekly (MA10 vs MA30 mingguan) dipakai
  // buat cegah sinyal harian/jam-an LAWAN ARAH TREND BESAR -- breakout daily kadang cuma noise
  // di tengah trend mingguan yang lebih kuat. bukan indikator baru, sama logic golden/death cross
  // di atas, cuma timeframe-nya digeser ke mingguan.
  const weeklyCloses = weekly.map((c) => c.close);
  const weeklyMa10 = sma(weeklyCloses, 10);
  const weeklyMa30 = sma(weeklyCloses, 30);
  const weeklyTrend = (weeklyMa10 && weeklyMa30)
    ? (weeklyMa10 > weeklyMa30 ? 'bullish' : weeklyMa10 < weeklyMa30 ? 'bearish' : 'netral')
    : null;

  const ma20 = sma(dailyCloses, 20);
  const ma50 = sma(dailyCloses, 50);
  const ma200 = sma(dailyCloses, 200);
  const rsi14Daily = rsi(dailyCloses, 14);

  // Death cross / golden cross: bandingin MA50 vs MA200 sekarang vs beberapa hari lalu
  const ma50Prev = sma(dailyCloses.slice(0, -5), 50);
  const ma200Prev = sma(dailyCloses.slice(0, -5), 200);
  let crossSignal = null;
  if (ma50 && ma200 && ma50Prev && ma200Prev) {
    if (ma50Prev >= ma200Prev && ma50 < ma200) crossSignal = 'death_cross';
    else if (ma50Prev <= ma200Prev && ma50 > ma200) crossSignal = 'golden_cross';
    else crossSignal = ma50 < ma200 ? 'bearish_cross_active' : 'bullish_cross_active';
  }

  const { highs, lows } = findSwingPoints(hourly, 3);
  const resistanceZones = clusterLevels(highs.filter((h) => h.price > lastPrice), 0.4).slice(0, 3);
  const supportZones = clusterLevels(lows.filter((l) => l.price < lastPrice), 0.4).slice(0, 3);

  const recentHighs = highs.slice(-4);
  const recentLows = lows.slice(-4);
  const resistanceTrendline = fitTrendline(recentHighs);
  const supportTrendline = fitTrendline(recentLows);

  return {
    symbol, lastPrice,
    ma: { ma20, ma50, ma200 },
    rsi14Daily,
    crossSignal,
    weeklyTrend,
    resistanceZones, supportZones,
    trendline: {
      resistance: resistanceTrendline ? { ...resistanceTrendline, currentValue: resistanceTrendline.valueAt(hourly.length - 1), direction: resistanceTrendline.slope > 0 ? 'naik' : resistanceTrendline.slope < 0 ? 'turun' : 'datar' } : null,
      support: supportTrendline ? { ...supportTrendline, currentValue: supportTrendline.valueAt(hourly.length - 1), direction: supportTrendline.slope > 0 ? 'naik' : supportTrendline.slope < 0 ? 'turun' : 'datar' } : null,
    },
  };
}

module.exports = { fetchCandles, sma, ema, rsi, findSwingPoints, clusterLevels, fitTrendline, analyze };

if (require.main === module) {
  analyze('BTCUSDT').then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((e) => {
    console.error('ERROR technicalAnalysis.js:', e.message);
    process.exit(1);
  });
}
