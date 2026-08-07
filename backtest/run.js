const { fetchKlines } = require('./fetchKlines');
const { buildSignalSeries } = require('./signalEngine');
const { runBacktest } = require('./backtest');

async function main() {
  const symbol = 'BTCUSDT';
  const now = Date.now();
  const listingDate = new Date('2017-08-17T00:00:00Z').getTime(); // BTCUSDT went live on Binance

  console.log('Fetching Daily candles (full history since listing)...');
  const daily = await fetchKlines(symbol, '1d', listingDate, now);
  console.log(`  ${daily.length} daily candles`);

  console.log('Fetching 4H candles (full history since listing)...');
  const h4 = await fetchKlines(symbol, '4h', listingDate, now);
  console.log(`  ${h4.length} 4H candles`);

  console.log('Building signal series...');
  const signalRows = buildSignalSeries(daily, h4);
  console.log(`  ${signalRows.length} usable daily checkpoints (after indicator warmup)`);

  const buyCount = signalRows.filter((r) => r.signal === 'BUY').length;
  const sellCount = signalRows.filter((r) => r.signal === 'SELL').length;
  const waitCount = signalRows.filter((r) => r.signal === 'WAIT').length;
  console.log(`  Signal breakdown: BUY=${buyCount} SELL=${sellCount} WAIT=${waitCount}`);

  console.log('\nRunning backtest (Kaela paper account, start $100)...\n');
  const result = runBacktest(daily, signalRows);

  console.log('=== HASIL BACKTEST ===');
  console.log(`Periode: ${signalRows[0]?.date} s/d ${signalRows[signalRows.length - 1]?.date}`);
  console.log(`Saldo awal:        $${result.startingBalance.toFixed(2)}`);
  console.log(`Total disetor:     $${result.totalDeposited.toFixed(2)} (awal + top-up bulanan tgl 5, berhenti begitu saldo >= $1000)`);
  console.log(`Saldo akhir:       $${result.endingBalance.toFixed(2)}`);
  console.log(`Net profit trading:$${result.netTradingProfit.toFixed(2)} (saldo akhir - total disetor)`);
  console.log(`Return atas modal disetor: ${result.returnOnDepositedPct.toFixed(2)}%`);
  console.log(`Total trade:       ${result.totalTrades}`);
  console.log(`Win / Loss:        ${result.wins} / ${result.losses}`);
  console.log(`Win rate:          ${result.winRatePct.toFixed(1)}%`);
  console.log(`Max drawdown:      ${result.maxDrawdownPct.toFixed(2)}%`);

  console.log('\n=== DETAIL TRADE ===');
  for (const t of result.trades) {
    console.log(
      `${t.entryDate} -> ${t.exitDate} | ${t.direction.padEnd(4)} | entry=${t.entry.toFixed(0)} exit=${t.exit.toFixed(0)} | ` +
      `${t.result.padEnd(3)} | lev=${t.leverage}x exp=${t.exposure}x | saldo ${t.balanceBefore.toFixed(2)} -> ${t.balanceAfter.toFixed(2)}`
    );
  }

  const fs = require('fs');
  fs.writeFileSync(
    require('path').join(__dirname, 'backtest-result.json'),
    JSON.stringify(result, null, 2)
  );
  console.log('\nHasil lengkap disimpan ke backtest-result.json');
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
