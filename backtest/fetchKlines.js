const BASE_URL = 'https://api.binance.com/api/v3/klines';

function parseCandle(raw) {
  return {
    openTime: raw[0],
    open: parseFloat(raw[1]),
    high: parseFloat(raw[2]),
    low: parseFloat(raw[3]),
    close: parseFloat(raw[4]),
    closeTime: raw[6],
  };
}

async function fetchKlines(symbol, interval, startTime, endTime) {
  const candles = [];
  let cursor = startTime;

  while (cursor < endTime) {
    const url = `${BASE_URL}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance API error ${res.status}: ${await res.text()}`);
    const raw = await res.json();
    if (raw.length === 0) break;

    for (const r of raw) candles.push(parseCandle(r));
    const lastCloseTime = raw[raw.length - 1][6];
    if (lastCloseTime <= cursor) break;
    cursor = lastCloseTime + 1;
    if (raw.length < 1000) break;
  }

  return candles;
}

module.exports = { fetchKlines };
