// Refresh backtest/dxy-daily-cache.json -- data harian DXY (DX-Y.NYB, Yahoo Finance), dipakai
// backtest/dxyFilter.js. Pola sama kayak refreshCache.js/refreshGoldCache.js -- cache di
// .gitignore (regeneratable), jalanin ini manual kalau perlu data DXY terbaru buat riset ulang.

const fs = require('fs');
const path = require('path');

async function main() {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&period1=1483228800&period2=' + Math.floor(Date.now() / 1000);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const r = data.chart.result[0];
  const closes = r.indicators.quote[0].close;
  const out = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (closes[i] == null) continue;
    out.push({ closeTime: r.timestamp[i] * 1000, close: closes[i] });
  }
  fs.writeFileSync(path.join(__dirname, 'dxy-daily-cache.json'), JSON.stringify(out));
  console.log(`[RefreshDxyCache] Tersimpan ${out.length} candle DXY harian, rentang ${new Date(out[0].closeTime).toISOString().slice(0, 10)} -> ${new Date(out[out.length - 1].closeTime).toISOString().slice(0, 10)}.`);
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR refreshDxyCache.js:', e.message); process.exit(1); });
}

module.exports = { main };
