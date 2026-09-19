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

// Fix 14 Agu 2026 (bug KRITIS ketauan pas audit): Binance selalu nyertain candle PALING BARU
// yang MASIH JALAN (belum closed) sebagai elemen terakhir tiap query "N candle terakhir" --
// tanpa filter ini, `daily[daily.length-1]` yang dipakai sniperAutoAnalysis.js buat cek breakout
// itu candle yang BARU MULAI beberapa menit lalu (open~=close candle sebelumnya, BUKAN candle
// kemarin yang beneran closed) -- mentahin seluruh premis "tunggu candle harian CLOSE dulu baru
// konfirmasi sinyal". Fetch limit+1 lalu filter closeTime<=now, biar caller tetap dapet `limit`
// candle CLOSED penuh (bukan limit-1) kayak yang mereka minta.
async function fetchCandles(symbol, interval, limit) {
  const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=${interval}&limit=${limit + 1}`);
  const raw = await res.json();
  const nowMs = Date.now();
  return raw.map(parseCandle).filter((c) => c.closeTime <= nowMs).slice(-limit);
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
  // 🐛 FIX 19 Sep 2026 (audit) -- SEBELUMNYA `avgLoss === 0` return 100 gak bedain 2 kasus: (a)
  // avgGain>0 & avgLoss=0 (semua candle naik, RSI=100 BENAR), vs (b) avgGain=0 & avgLoss=0 (harga
  // FLAT TOTAL sepanjang periode, harusnya NETRAL 50, bukan "overbought" 100). Edge case murni
  // teoretis buat BTC/Emas real (harga gak pernah benar2 flat), tapi worth dibenerin sekalian.
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ATR (Average True Range, 30 Agu 2026, riset upgrade Nyopet -- lihat memori
// project-olz-exposure-calculator: "nyawa% Nyopet FLAT 2% terus, idealnya ikut volatilitas").
// True Range = jarak TERBESAR dari 3 kemungkinan (high-low hari ini, |high-close kemarin|,
// |low-close kemarin|) -- standar Wilder, nangkep gap yang gak keliatan dari high-low doang.
// `candles`: array {high,low,close} urut kronologis, TERAKHIR = titik yang mau dihitung ATR-nya.
// Return null kalau data kurang (butuh minimal period+1 candle buat 1 True Range pertama).
function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trueRanges = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    trueRanges.push(tr);
  }
  return trueRanges.reduce((a, b) => a + b, 0) / period;
}

// ============ ADX (Average Directional Index) -- gerbang KEKUATAN/ARAH tren, standar Wilder ============
// Ditambah 15 Sep 2026 (RESEARCH-LOG.md, ide "[PRIORITAS] ADX sbg gerbang trend-strength buat
// window Emas") -- beda dari ATR di atas (ngukur BESARAN gerakan harga): ADX ngukur KEKUATAN/ARAH
// tren, market bisa VOLATILE tapi tetap CHOPPY/gak kemana-mana (ADX rendah). Teknik standar trader
// profesional (managed futures/CTA) buat bedain regime trending vs ranging.
// `adxSeries` ngitung SATU KALI dalam 1 pass (bukan rekursif slice-ulang tiap titik kayak `ema()`)
// -- WAJIB dipakai di backtest yang butuh nilai ADX di RIBUAN titik historis (perf), array hasil
// selaras index sama `candles` (null di titik yang datanya belum cukup). `adx()` cuma snapshot
// nilai TERAKHIR dari array itu -- buat pemakaian live/sekali-panggil (candle daily/harian kecil).
function adxSeries(candles, period = 14) {
  const n = candles.length;
  const series = new Array(n).fill(null);
  if (n < period * 2 + 1) return series;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const c = candles[i], prev = candles[i - 1];
    const upMove = c.high - prev.high;
    const downMove = prev.low - c.low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  }
  // Wilder smoothing (rolling, satu pass): nilai pertama = SUM `period` elemen pertama, abis itu
  // smoothed[i] = smoothed[i-1] - smoothed[i-1]/period + nilai_baru[i].
  let smTR = 0, smPlus = 0, smMinus = 0;
  const smTRArr = new Array(n).fill(null), smPlusArr = new Array(n).fill(null), smMinusArr = new Array(n).fill(null);
  for (let i = 1; i <= period; i++) { smTR += tr[i]; smPlus += plusDM[i]; smMinus += minusDM[i]; }
  smTRArr[period] = smTR; smPlusArr[period] = smPlus; smMinusArr[period] = smMinus;
  for (let i = period + 1; i < n; i++) {
    smTR = smTR - smTR / period + tr[i];
    smPlus = smPlus - smPlus / period + plusDM[i];
    smMinus = smMinus - smMinus / period + minusDM[i];
    smTRArr[i] = smTR; smPlusArr[i] = smPlus; smMinusArr[i] = smMinus;
  }
  const dx = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    const plusDI = smTRArr[i] > 0 ? (smPlusArr[i] / smTRArr[i]) * 100 : 0;
    const minusDI = smTRArr[i] > 0 ? (smMinusArr[i] / smTRArr[i]) * 100 : 0;
    const diSum = plusDI + minusDI;
    dx[i] = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
  }
  // ADX = Wilder-smoothed rata-rata DX -- nilai pertama simple average `period` DX pertama
  // (titik 2*period), abis itu smoothing sama pola di atas.
  let sumDx = 0;
  for (let i = period; i < period * 2; i++) sumDx += dx[i];
  let adxVal = sumDx / period;
  series[period * 2] = adxVal;
  for (let i = period * 2 + 1; i < n; i++) {
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
    series[i] = adxVal;
  }
  return series;
}
function adx(candles, period = 14) {
  const series = adxSeries(candles, period);
  return series[series.length - 1];
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
  // Jarak % MA10 vs MA30 mingguan = proxy KEKUATAN trend (bukan cuma arah) -- dipakai buat
  // nentuin seberapa ambisius target TP (lihat sniperAutoAnalysis.js pickAdaptiveTp/classifyWeeklyStrength).
  const weeklyMomentumPct = (weeklyMa10 && weeklyMa30) ? Math.abs((weeklyMa10 - weeklyMa30) / weeklyMa30) * 100 : null;

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
  // SENGAJA gak dibatasin cuma top-3-by-touches (dulu `.slice(0,3)`) -- sniperAutoAnalysis.js
  // butuh akses ke SEMUA zona buat milih SL "paling deket" (10 Agu 2026, tervalidasi backtest:
  // SL paling deket >> SL paling tersentuh). `[0]` (paling tersentuh) tetap dipakai buat deteksi
  // breakout & tampilan "kunci" -- itu tujuannya beda (level paling SIGNIFIKAN historis),
  // bukan buat invalidation yang natural harus tipis.
  const resistanceZones = clusterLevels(highs.filter((h) => h.price > lastPrice), 0.4);
  const supportZones = clusterLevels(lows.filter((l) => l.price < lastPrice), 0.4);

  const recentHighs = highs.slice(-4);
  const recentLows = lows.slice(-4);
  const resistanceTrendline = fitTrendline(recentHighs);
  const supportTrendline = fitTrendline(recentLows);

  return {
    symbol, lastPrice,
    ma: { ma20, ma50, ma200 },
    rsi14Daily,
    crossSignal,
    weeklyTrend, weeklyMomentumPct,
    resistanceZones, supportZones,
    trendline: {
      resistance: resistanceTrendline ? { ...resistanceTrendline, currentValue: resistanceTrendline.valueAt(hourly.length - 1), direction: resistanceTrendline.slope > 0 ? 'naik' : resistanceTrendline.slope < 0 ? 'turun' : 'datar' } : null,
      support: supportTrendline ? { ...supportTrendline, currentValue: supportTrendline.valueAt(hourly.length - 1), direction: supportTrendline.slope > 0 ? 'naik' : supportTrendline.slope < 0 ? 'turun' : 'datar' } : null,
    },
  };
}

module.exports = { fetchCandles, sma, ema, rsi, atr, adx, adxSeries, findSwingPoints, clusterLevels, fitTrendline, analyze };

if (require.main === module) {
  analyze('BTCUSDT').then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((e) => {
    console.error('ERROR technicalAnalysis.js:', e.message);
    process.exit(1);
  });
}
