// Fetch histori LENGKAP funding rate BTCUSDT perpetual (Binance Futures) -- dipakai riset baru
// "funding rate sbg konfirmasi entry" (14 Sep 2026, dari daftar "Ide belum dicoba" di RESEARCH-LOG.md).
// Tool sekali-pakai, jalanin manual (`node backtest/refreshFundingCache.js`). Cache-nya SENGAJA
// dipisah dari hourly/daily-cache.json (data beda struktur -- interval 8 jam, bukan candle OHLC).
const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('../httpRetry');

const BASE_URL = 'https://fapi.binance.com/fapi/v1/fundingRate';

async function fetchAllFundingRates(symbol, startTime) {
  let all = [];
  let cursor = startTime;
  for (;;) {
    const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&startTime=${cursor}&limit=1000`);
    const raw = await res.json();
    if (!raw.length) break;
    all = all.concat(raw.map((r) => ({ fundingTime: r.fundingTime, fundingRate: +r.fundingRate })));
    if (raw.length < 1000) break;
    cursor = raw[raw.length - 1].fundingTime + 1;
  }
  return all;
}

async function main() {
  // BTCUSDT perpetual mulai jauh sebelum ini, tapi backtest project ini SERAGAM mulai 2020 (lihat
  // dxyNyopetScrutiny.js) -- fetch dari 2019-09-01 (sebelum 2020) biar SMA rolling di titik awal
  // 2020 udah punya cukup histori warmup, bukan mulai dari nol.
  const startTime = new Date('2019-09-01').getTime();
  console.log('Fetching BTCUSDT funding rate history...');
  const rates = await fetchAllFundingRates('BTCUSDT', startTime);
  console.log(`funding: ${rates.length} entries, ${new Date(rates[0].fundingTime).toISOString()} -> ${new Date(rates[rates.length - 1].fundingTime).toISOString()}`);
  fs.writeFileSync(path.join(__dirname, 'funding-rate-cache.json'), JSON.stringify(rates));
}

main().catch((e) => { console.error('ERROR refreshFundingCache.js:', e.message); process.exit(1); });
