// Own implementations — no third-party indicator scripts (LuxAlgo/AlgoAlpha are protected & paid).
// Both operate on a plain array of {open, high, low, close} candles, oldest first.

function trueRange(candles, i) {
  const c = candles[i];
  if (i === 0) return c.high - c.low;
  const prevClose = candles[i - 1].close;
  return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
}

// SuperTrend (ATR-based, Wilder smoothing). Returns array aligned to candles:
// { trend: 'BULLISH' | 'BEARISH', value: number }
function superTrend(candles, period = 10, multiplier = 3) {
  const n = candles.length;
  const tr = new Array(n);
  for (let i = 0; i < n; i++) tr[i] = trueRange(candles, i);

  const atr = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += tr[j];
      atr[i] = sum / period;
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
  }

  const finalUpper = new Array(n).fill(null);
  const finalLower = new Array(n).fill(null);
  const trendArr = new Array(n).fill(null); // 'BULLISH' | 'BEARISH'
  const stValue = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (atr[i] === null) continue;
    const mid = (candles[i].high + candles[i].low) / 2;
    const basicUpper = mid + multiplier * atr[i];
    const basicLower = mid - multiplier * atr[i];

    const prevClose = i > 0 ? candles[i - 1].close : candles[i].close;
    const prevFinalUpper = i > 0 ? finalUpper[i - 1] : null;
    const prevFinalLower = i > 0 ? finalLower[i - 1] : null;

    finalUpper[i] = (prevFinalUpper === null || basicUpper < prevFinalUpper || prevClose > prevFinalUpper)
      ? basicUpper : prevFinalUpper;
    finalLower[i] = (prevFinalLower === null || basicLower > prevFinalLower || prevClose < prevFinalLower)
      ? basicLower : prevFinalLower;

    const prevTrend = i > 0 ? trendArr[i - 1] : null;
    const close = candles[i].close;

    if (prevTrend === null) {
      trendArr[i] = close >= finalUpper[i] ? 'BULLISH' : 'BEARISH';
    } else if (prevTrend === 'BEARISH') {
      trendArr[i] = close > finalUpper[i] ? 'BULLISH' : 'BEARISH';
    } else {
      trendArr[i] = close < finalLower[i] ? 'BEARISH' : 'BULLISH';
    }
    stValue[i] = trendArr[i] === 'BULLISH' ? finalLower[i] : finalUpper[i];
  }

  return candles.map((_, i) => ({ trend: trendArr[i], value: stValue[i] }));
}

// Structure / Break-of-Structure (own equivalent of SMC market structure).
// Fractal swing detection (k bars each side), trend flips on close breaking last confirmed opposite swing.
// Returns array aligned to candles: { state: 'BULLISH'|'BEARISH'|'NEUTRAL', lastSwingHigh, lastSwingLow }
function structureSignal(candles, k = 2) {
  const n = candles.length;
  const isSwingHigh = new Array(n).fill(false);
  const isSwingLow = new Array(n).fill(false);

  for (let i = k; i < n - k; i++) {
    let high = true, low = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) high = false;
      if (candles[j].low <= candles[i].low) low = false;
    }
    isSwingHigh[i] = high;
    isSwingLow[i] = low;
  }

  const out = new Array(n);
  let state = 'NEUTRAL';
  let lastSwingHigh = null;
  let lastSwingLow = null;
  let confirmedSwingHigh = null; // most recent CONFIRMED (i.e. k bars old) swing high value
  let confirmedSwingLow = null;

  for (let i = 0; i < n; i++) {
    // confirm pivot at i-k once we reach i (needed k bars after it to know it was a swing)
    const confirmIdx = i - k;
    if (confirmIdx >= 0) {
      if (isSwingHigh[confirmIdx]) confirmedSwingHigh = candles[confirmIdx].high;
      if (isSwingLow[confirmIdx]) confirmedSwingLow = candles[confirmIdx].low;
    }

    if (confirmedSwingHigh !== null && candles[i].close > confirmedSwingHigh) state = 'BULLISH';
    if (confirmedSwingLow !== null && candles[i].close < confirmedSwingLow) state = 'BEARISH';

    lastSwingHigh = confirmedSwingHigh;
    lastSwingLow = confirmedSwingLow;

    out[i] = { state, lastSwingHigh, lastSwingLow };
  }

  return out;
}

module.exports = { superTrend, structureSignal, trueRange };
