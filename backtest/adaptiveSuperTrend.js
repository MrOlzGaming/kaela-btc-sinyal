const { trueRange } = require('./indicators');

// Adaptive SuperTrend: multiplier menyesuaikan diri berdasar rasio ATR sekarang vs rata-rata ATR historis.
// ATR tinggi (volatile) -> multiplier melebar (hindari stop palsu). ATR rendah (tenang) -> multiplier menyempit.
function adaptiveSuperTrend(candles, atrPeriod = 10, avgLookback = 50, baseMultiplier = 3, minMult = 1.5, maxMult = 4.5) {
  const n = candles.length;
  const tr = new Array(n);
  for (let i = 0; i < n; i++) tr[i] = trueRange(candles, i);

  const atr = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i < atrPeriod - 1) continue;
    if (i === atrPeriod - 1) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += tr[j];
      atr[i] = sum / atrPeriod;
    } else {
      atr[i] = (atr[i - 1] * (atrPeriod - 1) + tr[i]) / atrPeriod;
    }
  }

  // rata-rata ATR bergulir (buat referensi "normal")
  const avgAtr = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (atr[i] === null) continue;
    const start = Math.max(0, i - avgLookback + 1);
    let sum = 0, count = 0;
    for (let j = start; j <= i; j++) { if (atr[j] !== null) { sum += atr[j]; count++; } }
    avgAtr[i] = sum / count;
  }

  const finalUpper = new Array(n).fill(null);
  const finalLower = new Array(n).fill(null);
  const trendArr = new Array(n).fill(null);
  const stValue = new Array(n).fill(null);
  const multUsed = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (atr[i] === null || avgAtr[i] === null) continue;

    const ratio = avgAtr[i] > 0 ? atr[i] / avgAtr[i] : 1;
    const multiplier = Math.min(maxMult, Math.max(minMult, baseMultiplier * ratio));
    multUsed[i] = multiplier;

    const mid = (candles[i].high + candles[i].low) / 2;
    const basicUpper = mid + multiplier * atr[i];
    const basicLower = mid - multiplier * atr[i];

    const prevClose = i > 0 ? candles[i - 1].close : candles[i].close;
    const prevFinalUpper = i > 0 ? finalUpper[i - 1] : null;
    const prevFinalLower = i > 0 ? finalLower[i - 1] : null;

    finalUpper[i] = (prevFinalUpper === null || basicUpper < prevFinalUpper || prevClose > prevFinalUpper) ? basicUpper : prevFinalUpper;
    finalLower[i] = (prevFinalLower === null || basicLower > prevFinalLower || prevClose < prevFinalLower) ? basicLower : prevFinalLower;

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

  return candles.map((_, i) => ({ trend: trendArr[i], value: stValue[i], multiplier: multUsed[i] }));
}

module.exports = { adaptiveSuperTrend };
