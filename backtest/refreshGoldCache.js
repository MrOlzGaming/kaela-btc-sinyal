// Fetch+cache candle PAXGUSDT hourly (Emas) -- dipakai backtest/nyopetChartPatternFvg.js buat
// riset "Nyopet v2" multi-aset (30 Agu 2026, permintaan Olan: "bukan cuma BTC.. tapi BTC dan
// Emas", sama pola kayak Sniper yang udah 2 aset). Data Binance PAXGUSDT mulai ~28 Agu 2020.
const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('../httpRetry');

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

async function main() {
  const startTime = new Date('2020-08-01').getTime();
  console.log('Fetching PAXGUSDT hourly candles...');
  const hourly = await fetchAllCandles('PAXGUSDT', '1h', startTime);
  console.log(`hourly: ${hourly.length}, first: ${new Date(hourly[0].closeTime).toISOString()}, last: ${new Date(hourly[hourly.length - 1].closeTime).toISOString()}`);
  fs.writeFileSync(path.join(__dirname, 'gold-hourly-cache.json'), JSON.stringify(hourly));
}

main().catch((e) => { console.error('ERROR refreshGoldCache.js:', e.message); process.exit(1); });
