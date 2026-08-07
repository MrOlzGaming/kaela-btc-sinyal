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
  const symbol = 'BTCUSDT';
  const now = Date.now();
  const listingDate = new Date('2017-08-17T00:00:00Z').getTime();

  console.log('Fetching Daily candles (full history)...');
  const daily = await fetchKlines(symbol, '1d', listingDate, now);
  console.log(`  ${daily.length} daily candles`);

  console.log('Fetching 4H candles (full history)...');
  const h4 = await fetchKlines(symbol, '4h', listingDate, now);
  console.log(`  ${h4.length} 4H candles`);

  // --- Benchmark: buy & hold polos ---
  const first = daily[0];
  const last = daily[daily.length - 1];
  const holdReturnPct = (last.close / first.close - 1) * 100;

  // --- Benchmark: timing siklus halving ---
  const buy1 = first;
  const sell1 = priceNear(daily, '2021-11-08');
  const buy2 = priceNear(daily, '2024-01-01');
  const sell2 = priceNear(daily, '2025-10-19');
  const halvingMultiple = (sell1.close / buy1.close) * (sell2.close / buy2.close);
  const halvingReturnPct = (halvingMultiple - 1) * 100;

  console.log('\n=== BENCHMARK (tanpa leverage, tanpa risiko likuidasi) ===');
  console.log(`Buy & Hold polos:        ${holdReturnPct.toFixed(1)}%`);
  console.log(`Timing siklus halving:   ${halvingReturnPct.toFixed(1)}%`);

  const stPeriods = [10, 14];
  const stMultipliers = [2, 3];
  const structKs = [2, 5];
  const comboModes = ['AND', 'OR', 'ST_ONLY', 'STRUCT_ONLY'];
  const rrs = [1.5, 2, 3];
  const riskPerTradePcts = [1.0, 0.5, 0.25, 0.1, 0.05];
  const longOnlyOptions = [false, true];

  const results = [];
  const total = stPeriods.length * stMultipliers.length * structKs.length * comboModes.length * rrs.length * riskPerTradePcts.length * longOnlyOptions.length;
  console.log(`\nMenjalankan sweep: ${total} kombinasi (termasuk risk-per-trade sizing + long-only)...\n`);

  const t0 = Date.now();

  for (const stPeriod of stPeriods) {
    for (const stMultiplier of stMultipliers) {
      for (const structK of structKs) {
        for (const comboMode of comboModes) {
          const signalRows = buildSignalSeries(daily, h4, { stPeriod, stMultiplier, structK, comboMode });

          for (const rr of rrs) {
            for (const riskPerTradePct of riskPerTradePcts) {
              for (const longOnly of longOnlyOptions) {
                const result = runBacktest(daily, signalRows, { rr, riskPerTradePct, longOnly });
                results.push({
                  params: { stPeriod, stMultiplier, structK, comboMode, rr, riskPerTradePct, longOnly },
                  totalTrades: result.totalTrades,
                  winRatePct: result.winRatePct,
                  maxDrawdownPct: result.maxDrawdownPct,
                  netWorth: result.netWorth,
                  totalDeposited: result.totalDeposited,
                  returnOnDepositedPct: result.returnOnDepositedPct,
                  reached100k: result.reached100k,
                });
              }
            }
          }
        }
      }
    }
  }

  console.log(`Sweep selesai: ${results.length} kombinasi dalam ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const qualified = results.filter((r) => r.totalTrades >= 10);

  // Ranking 1: return tertinggi tanpa syarat drawdown
  const byReturn = [...qualified].sort((a, b) => b.returnOnDepositedPct - a.returnOnDepositedPct);
  console.log('=== TOP 10 by RETURN (berapapun drawdown-nya) ===');
  printTable(byReturn.slice(0, 10));

  // Ranking 2: cuma yang drawdown <= 50%, baru ranking return
  const survivable = qualified.filter((r) => r.maxDrawdownPct <= 50);
  console.log(`\n=== TOP 10 by RETURN, SYARAT Max Drawdown <= 50% (${survivable.length} kombinasi qualified) ===`);
  survivable.sort((a, b) => b.returnOnDepositedPct - a.returnOnDepositedPct);
  printTable(survivable.slice(0, 10));

  console.log('\n=== PERBANDINGAN AKHIR ===');
  console.log(`Buy & Hold polos (no leverage, no liq risk):     ${holdReturnPct.toFixed(1)}%`);
  console.log(`Timing siklus halving (no leverage, no liq risk):${halvingReturnPct.toFixed(1)}%`);
  if (survivable.length) {
    const best = survivable[0];
    console.log(`Trading kita TERBAIK (DD<=50%):                  ${best.returnOnDepositedPct.toFixed(1)}% (DD=${best.maxDrawdownPct.toFixed(1)}%, risk/trade=${best.params.riskPerTradePct * 100}%)`);
  } else {
    console.log('Trading kita TERBAIK (DD<=50%):                   TIDAK ADA kombinasi yang qualified');
  }
  console.log(`Trading kita TERBAIK (drawdown berapapun):       ${byReturn[0].returnOnDepositedPct.toFixed(1)}% (DD=${byReturn[0].maxDrawdownPct.toFixed(1)}%)`);

  const fs = require('fs');
  fs.writeFileSync(require('path').join(__dirname, 'sweep-result.json'), JSON.stringify(qualified, null, 2));
  console.log('\nSemua hasil disimpan ke sweep-result.json');
}

function printTable(rows) {
  console.log('stP  mult  k  combo        RR   risk%  long-only  trades  winrate  maxDD    return%');
  for (const r of rows) {
    const p = r.params;
    console.log(
      `${String(p.stPeriod).padEnd(4)} ${String(p.stMultiplier).padEnd(5)} ${String(p.structK).padEnd(2)} ` +
      `${p.comboMode.padEnd(12)} ${String(p.rr).padEnd(4)} ${String(p.riskPerTradePct * 100).padEnd(6)} ${String(p.longOnly).padEnd(10)} ${String(r.totalTrades).padEnd(7)} ` +
      `${r.winRatePct.toFixed(1).padEnd(8)} ${r.maxDrawdownPct.toFixed(1).padEnd(8)} ${r.returnOnDepositedPct.toFixed(1)}`
    );
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
