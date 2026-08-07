const { fetchKlines } = require('./fetchKlines');
const { buildSignalSeries } = require('./signalEngine');
const { runBacktest } = require('./backtest');

function priceNear(daily, dateStr) {
  const t = new Date(dateStr).getTime();
  let closest = daily[0];
  for (const c of daily) if (Math.abs(c.closeTime - t) < Math.abs(closest.closeTime - t)) closest = c;
  return closest;
}

async function main() {
  const now = Date.now();
  const listingDate = new Date('2017-08-17T00:00:00Z').getTime();

  console.log('Fetching data...');
  const daily = await fetchKlines('BTCUSDT', '1d', listingDate, now);
  const h4 = await fetchKlines('BTCUSDT', '4h', listingDate, now);
  console.log(`  ${daily.length} daily, ${h4.length} 4H candles\n`);

  const first = daily[0];
  const last = daily[daily.length - 1];
  const holdReturnPct = (last.close / first.close - 1) * 100;
  const sell1 = priceNear(daily, '2021-11-08');
  const buy2 = priceNear(daily, '2024-01-01');
  const sell2 = priceNear(daily, '2025-10-19');
  const halvingMultiple = (sell1.close / first.close) * (sell2.close / buy2.close);
  const halvingReturnPct = (halvingMultiple - 1) * 100;
  console.log('Benchmark Buy&Hold:', holdReturnPct.toFixed(1) + '%  |  Benchmark Halving-timing:', halvingReturnPct.toFixed(1) + '%\n');

  const stPeriods = [10, 14, 21];
  const stMultipliers = [2, 3];
  const structKs = [2, 5];
  const comboModes = ['AND', 'OR', 'ST_ONLY', 'STRUCT_ONLY'];
  const rrs = [1.5, 2, 3];
  const riskPerTradePcts = [0.5, 0.25, 0.1, 0.05, 0.03, 0.02, 0.01];

  const results = [];
  const total = stPeriods.length * stMultipliers.length * structKs.length * comboModes.length * rrs.length * riskPerTradePcts.length;
  console.log(`Menjalankan ${total} kombinasi (long-only, fokus risk-per-trade kecil)...\n`);

  const t0 = Date.now();
  for (const stPeriod of stPeriods) {
    for (const stMultiplier of stMultipliers) {
      for (const structK of structKs) {
        for (const comboMode of comboModes) {
          const signalRows = buildSignalSeries(daily, h4, { stPeriod, stMultiplier, structK, comboMode });
          for (const rr of rrs) {
            for (const riskPerTradePct of riskPerTradePcts) {
              const r = runBacktest(daily, signalRows, { rr, longOnly: true, riskPerTradePct });
              results.push({
                params: { stPeriod, stMultiplier, structK, comboMode, rr, riskPerTradePct },
                totalTrades: r.totalTrades,
                winRatePct: r.winRatePct,
                maxDrawdownPct: r.maxDrawdownPct,
                returnOnDepositedPct: r.returnOnDepositedPct,
              });
            }
          }
        }
      }
    }
  }
  console.log(`Selesai: ${results.length} kombinasi dalam ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const qualified = results.filter((r) => r.totalTrades >= 10);
  const years = 9;

  for (const ddCap of [15, 25, 35, 50]) {
    const survivable = qualified.filter((r) => r.maxDrawdownPct <= ddCap);
    survivable.sort((a, b) => b.returnOnDepositedPct - a.returnOnDepositedPct);
    console.log(`=== Max Drawdown <= ${ddCap}% (${survivable.length} kombinasi qualified) ===`);
    if (survivable.length) {
      const top = survivable[0];
      const cagr = (Math.pow(1 + top.returnOnDepositedPct / 100, 1 / years) - 1) * 100;
      console.log(`  Terbaik: ${JSON.stringify(top.params)}`);
      console.log(`  trades=${top.totalTrades} winrate=${top.winRatePct.toFixed(1)}% maxDD=${top.maxDrawdownPct.toFixed(1)}% return=${top.returnOnDepositedPct.toFixed(1)}% CAGR=${cagr.toFixed(1)}%/th`);
    } else {
      console.log('  (kosong)');
    }
    console.log();
  }

  const fs = require('fs');
  fs.writeFileSync(require('path').join(__dirname, 'sweep2-result.json'), JSON.stringify(qualified, null, 2));
  console.log('Semua hasil disimpan ke sweep2-result.json');
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
