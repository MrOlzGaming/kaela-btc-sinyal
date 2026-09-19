// btcVsXauSameStartCompare.js (19 Sep 2026, permintaan Olan: "minta seluruh data backtest BTC
// dan Emas dengan tahun mulai yang sama") -- BTC (Binance BTCUSDT) datanya CUMA ada mulai
// 2017-08-17 (tanggal listing asli, gak bisa diperpanjang ke belakang), sedangkan Emas (COMEX
// gold futures via cache) punya histori jauh lebih panjang (2001+). Biar perbandingan ADIL
// (bukan Emas "menang" cuma krn kebagian lebih banyak tahun data buat compounding), KEDUANYA
// dipotong ke jendela 2017-08-17 -> tanggal terakhir yang SAMA-SAMA tersedia.
const fs = require('fs');
const path = require('path');
const { runFlagBacktest, runFlagBacktestWindowGated, summarize, makeXauBearWindowFn } = require('../backtestFlagBreakout');
const { isBtcBearWindow } = require('../halvingBearWindow');

const COMMON_START = new Date('2017-08-17').getTime();

function loadAndTrim(cachePath) {
  const all = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  return all.filter((c) => c.closeTime >= COMMON_START);
}

function report(label, candles, bearWindowFn) {
  const baseline = runFlagBacktest(candles, { allowShort: false });
  const baselineS = summarize(baseline.trades);
  const wg = runFlagBacktestWindowGated(candles, { bearWindowFn, maxNyawaPct: 20 });
  const wgS = summarize(wg.trades);
  const shorts = wg.trades.filter((t) => t.direction === 'sell');
  const flips = wg.trades.filter((t) => t.exitReason === 'WINDOW_FLIP');

  console.log(`\n========== ${label} (${new Date(candles[0].closeTime).toISOString().slice(0, 10)} -> ${new Date(candles[candles.length - 1].closeTime).toISOString().slice(0, 10)}, ${candles.length} candle) ==========`);
  console.log(`[BASELINE buy-only]      n=${baselineS.n} | PF=${baselineS.profitFactor} | totalR=${baselineS.totalR} | finalCapital=$${baseline.finalCapital.toFixed(2)} | maxDD=${baseline.maxDrawdownPct.toFixed(1)}%`);
  console.log(`[WINDOW-GATED live-like] n=${wgS.n} (short=${shorts.length}, flip=${flips.length}) | PF=${wgS.profitFactor} | totalR=${wgS.totalR} | finalCapital=$${wg.finalCapital.toFixed(2)} | maxDD=${wg.maxDrawdownPct.toFixed(1)}%`);
  console.log(`  -- SHORT saja: totalPnl=$${shorts.reduce((a, t) => a + t.pnlUsd, 0).toFixed(2)} | WINDOW_FLIP totalPnl=$${flips.reduce((a, t) => a + t.pnlUsd, 0).toFixed(2)}`);

  console.log(`-- Breakdown per tahun (WINDOW-GATED, yang live sekarang) --`);
  const byYear = {};
  for (const t of wg.trades) {
    const y = new Date(t.entryTime).getUTCFullYear();
    (byYear[y] = byYear[y] || []).push(t);
  }
  for (const y of Object.keys(byYear).sort()) {
    const ts = byYear[y];
    const s2 = summarize(ts);
    const nShort = ts.filter((t) => t.direction === 'sell').length;
    console.log(`  ${y}: n=${s2.n} (short=${nShort}) | winRate=${s2.winRate} | totalPnl=$${ts.reduce((s3, t) => s3 + t.pnlUsd, 0).toFixed(2)}`);
  }
  return { baseline, wg };
}

const btcDaily = loadAndTrim(path.join(__dirname, 'daily-cache.json'));
const goldDaily = loadAndTrim(path.join(__dirname, 'gold-daily-cache.json'));

report('BTC', btcDaily, isBtcBearWindow);
report('EMAS (XAU)', goldDaily, makeXauBearWindowFn(goldDaily));
