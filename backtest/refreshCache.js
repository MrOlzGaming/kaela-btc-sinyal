// Refresh hourly-cache.json / daily-cache.json (dipakai darkKaelaLiquidity.js dkk) -- data lama
// kepotong 7 Agu 2026, riset baru butuh data sampai sekarang. Tool sekali-pakai, jalanin manual.
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
  const startTime = new Date('2017-08-17').getTime();
  console.log('Fetching hourly candles...');
  const hourly = await fetchAllCandles('BTCUSDT', '1h', startTime);
  console.log(`hourly: ${hourly.length}, last: ${new Date(hourly[hourly.length - 1].closeTime).toISOString()}`);
  fs.writeFileSync(path.join(__dirname, 'hourly-cache.json'), JSON.stringify(hourly));

  console.log('Fetching daily candles...');
  const daily = await fetchAllCandles('BTCUSDT', '1d', startTime);
  console.log(`daily: ${daily.length}, last: ${new Date(daily[daily.length - 1].closeTime).toISOString()}`);
  fs.writeFileSync(path.join(__dirname, 'daily-cache.json'), JSON.stringify(daily));
}

main().catch((e) => { console.error('ERROR refreshCache.js:', e.message); process.exit(1); });
