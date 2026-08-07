const { superTrend, structureSignal } = require('./indicators');

// Find the last 4H candle whose closeTime <= targetTime.
function findAlignedIndex(h4Candles, targetTime) {
  let lo = 0, hi = h4Candles.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (h4Candles[mid].closeTime <= targetTime) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

// comboMode: 'AND' (both must agree), 'OR' (either is enough), 'ST_ONLY', 'STRUCT_ONLY'
function readTimeframe(stState, structState, comboMode) {
  if (comboMode === 'ST_ONLY') return stState.trend;
  if (comboMode === 'STRUCT_ONLY') return structState.state === 'NEUTRAL' ? 'WAIT' : structState.state;

  if (comboMode === 'OR') {
    if (stState.trend === 'BULLISH' || structState.state === 'BULLISH') {
      if (stState.trend === 'BEARISH' || structState.state === 'BEARISH') return 'WAIT'; // conflicting
      return 'BULLISH';
    }
    if (stState.trend === 'BEARISH' || structState.state === 'BEARISH') return 'BEARISH';
    return 'WAIT';
  }

  // AND (default)
  if (stState.trend === 'BULLISH' && structState.state === 'BULLISH') return 'BULLISH';
  if (stState.trend === 'BEARISH' && structState.state === 'BEARISH') return 'BEARISH';
  return 'WAIT';
}

// Produces one row per Daily candle (aligned to the 4H candle that closes at/before it).
function buildSignalSeries(dailyCandles, h4Candles, opts = {}) {
  const { stPeriod = 10, stMultiplier = 3, structK = 2, comboMode = 'AND' } = opts;

  const dailyST = superTrend(dailyCandles, stPeriod, stMultiplier);
  const dailyStruct = structureSignal(dailyCandles, structK);
  const h4ST = superTrend(h4Candles, stPeriod, stMultiplier);
  const h4Struct = structureSignal(h4Candles, structK);

  const rows = [];

  for (let i = 0; i < dailyCandles.length; i++) {
    if (!dailyST[i].trend) continue; // not enough data yet for ATR warmup

    const h4Idx = findAlignedIndex(h4Candles, dailyCandles[i].closeTime);
    if (h4Idx === -1 || !h4ST[h4Idx].trend) continue;

    const dailyRead = readTimeframe(dailyST[i], dailyStruct[i], comboMode);
    const h4Read = readTimeframe(h4ST[h4Idx], h4Struct[h4Idx], comboMode);

    let final = 'WAIT';
    let reason = null;

    if (dailyRead === 'BULLISH' && h4Read === 'BULLISH') final = 'BUY';
    else if (dailyRead === 'BEARISH' && h4Read === 'BEARISH') final = 'SELL';
    else {
      const parts = [];
      if (dailyRead === 'WAIT') {
        parts.push(`Daily: SuperTrend=${dailyST[i].trend}, Structure=${dailyStruct[i].state} (belum sepakat)`);
      } else {
        parts.push(`Daily=${dailyRead}`);
      }
      if (h4Read === 'WAIT') {
        parts.push(`4H: SuperTrend=${h4ST[h4Idx].trend}, Structure=${h4Struct[h4Idx].state} (belum sepakat)`);
      } else {
        parts.push(`4H=${h4Read}`);
      }
      if (dailyRead !== 'WAIT' && h4Read !== 'WAIT' && dailyRead !== h4Read) {
        parts.push(`Daily dan 4H belum align (${dailyRead} vs ${h4Read})`);
      }
      reason = parts.join(' | ');
    }

    rows.push({
      date: new Date(dailyCandles[i].closeTime).toISOString().slice(0, 10),
      closeTime: dailyCandles[i].closeTime,
      entryPrice: dailyCandles[i].close,
      dailyStructState: dailyStruct[i],
      signal: final,
      reason,
    });
  }

  return rows;
}

module.exports = { buildSignalSeries };
