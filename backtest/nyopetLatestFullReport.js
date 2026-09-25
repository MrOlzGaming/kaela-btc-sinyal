// nyopetLatestFullReport.js (23 Sep 2026) -- Olan minta "hasil backtest terbaru mode nyopet
// dengan semua alasan, coba long dan short di trading kan semua hasil apa". Reuse
// runNyopetV2BacktestWindowGated LANGSUNG (bukan runReport() di __main__ nyopetChartPatternFvg.js
// -- ketemu BUG di situ: runReport() manggil runNyopetV2Backtest, BUKAN versi WindowGated, jadi
// param bearWindowFn yang dioper ke situ KE-IGNORE DIAM-DIAM. Baris ini WAJIB manggil fungsi
// WindowGated eksplisit biar bener-bener match logic LIVE (nyopetAutoTrader.js): long di luar
// bear window, short CUMA pas bear window, force-close kalau window ganti pas posisi terbuka.
//
// ⚠️ GAP JUJUR: fungsi ini TIDAK punya param dxyFilter (beda dari runNyopetV2Backtest yang versi
// non-window-gated) -- live PUNYA konfirmasi DXY tambahan buat entry 'buy' (isDxyWeak, cuma
// TRIM sebagian entry saat dolar kuat). Backtest di sini SEDIKIT SUPERSET dari live (bisa ada
// sedikit lebih banyak entry buy dari yang live beneran ambil), TAPI arah/pola hasil tetap
// representatif.

const { CANDLES_4H, RESCALED_4H, makeBtcBearWindowFn, runNyopetV2BacktestWindowGated, summarize, byYear } = require('./rangerChartPatternFvg');

function breakdownByPatternAndDirection(trades) {
  const groups = {};
  trades.forEach((t) => {
    const key = t.patternType;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  return groups;
}

function pfOf(trades) {
  const win = trades.filter((t) => t.rMultiple > 0).reduce((s, t) => s + t.rMultiple, 0);
  const loss = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((s, t) => s + t.rMultiple, 0));
  return loss > 0 ? (win / loss).toFixed(2) : (win > 0 ? 'inf' : '0.00');
}

function main() {
  console.log(`Data BTC 4H: ${CANDLES_4H.length} candle, rentang ${new Date(CANDLES_4H[0].closeTime).toISOString().slice(0, 10)} -> ${new Date(CANDLES_4H[CANDLES_4H.length - 1].closeTime).toISOString().slice(0, 10)}`);
  console.log('Config: window-gated (long di luar bear window, short CUMA pas bear window), partial 2R + trail SMA-60 (4H, ~10 hari), modal/5 (cheat exposure), short exposure separuh long -- SEMUA persis parameter live sekarang.\n');

  const opts = { ...RESCALED_4H, modalDivisor: 5, bearWindowFn: makeBtcBearWindowFn() };
  const r = runNyopetV2BacktestWindowGated(CANDLES_4H, opts);
  const s = summarize(r.trades);

  console.log('=== AGREGAT (semua alasan digabung, window-gated) ===');
  console.log(`n=${s.n} | win rate=${s.winRate} | PF=${s.profitFactor} | totalR=${s.totalR} | avgR=${s.avgR}`);
  console.log(`Long: ${s.longCount} trade (win ${s.longWinRate}) | Short: ${s.shortCount} trade (win ${s.shortWinRate})`);
  console.log(`Final capital: $${r.finalCapital.toFixed(2)} (modal awal $100, ${((r.finalCapital / 100 - 1) * 100).toFixed(0)}%) | Max Drawdown: ${r.maxDrawdownPct.toFixed(1)}%`);
  const flips = r.trades.filter((t) => t.exitReason === 'WINDOW_FLIP');
  console.log(`WINDOW_FLIP (dipaksa tutup krn window ganti): ${flips.length}x, total PnL $${flips.reduce((a, t) => a + t.pnlUsd, 0).toFixed(2)}`);

  console.log('\n=== BREAKDOWN PER TAHUN ===');
  Object.entries(byYear(r.trades)).sort().forEach(([y, d]) => {
    console.log(`  ${y}: n=${d.count}, win=${(d.wins / d.count * 100).toFixed(1)}%, totalR=${d.totalR >= 0 ? '+' : ''}${d.totalR.toFixed(1)}R`);
  });

  console.log('\n=== SPLIT-ERA (2 potongan waktu independen) ===');
  const mid = Math.floor(r.trades.length / 2);
  const era1 = r.trades.slice(0, mid), era2 = r.trades.slice(mid);
  console.log(`  Era 1 (${new Date(era1[0]?.entryTime).toISOString().slice(0, 10)} -> ${new Date(era1[era1.length - 1]?.entryTime).toISOString().slice(0, 10)}): n=${era1.length}, PF=${pfOf(era1)}, totalR=${era1.reduce((a, t) => a + t.rMultiple, 0).toFixed(1)}`);
  console.log(`  Era 2 (${new Date(era2[0]?.entryTime).toISOString().slice(0, 10)} -> ${new Date(era2[era2.length - 1]?.entryTime).toISOString().slice(0, 10)}): n=${era2.length}, PF=${pfOf(era2)}, totalR=${era2.reduce((a, t) => a + t.rMultiple, 0).toFixed(1)}`);

  console.log('\n=== BREAKDOWN PER ALASAN (pattern type) x ARAH ===');
  const groups = breakdownByPatternAndDirection(r.trades);
  Object.entries(groups).sort((a, b) => b[1].length - a[1].length).forEach(([pattern, trades]) => {
    const dir = trades[0].direction === 'buy' ? 'LONG' : 'SHORT';
    const wins = trades.filter((t) => t.rMultiple > 0).length;
    console.log(`  ${pattern} (${dir}): n=${trades.length}, win=${(wins / trades.length * 100).toFixed(1)}%, PF=${pfOf(trades)}, totalR=${trades.reduce((a, t) => a + t.rMultiple, 0).toFixed(1)}`);
  });

  console.log('\n=== BREAKDOWN EXIT REASON ===');
  const exitGroups = {};
  r.trades.forEach((t) => { exitGroups[t.exitReason] = (exitGroups[t.exitReason] || 0) + 1; });
  Object.entries(exitGroups).sort((a, b) => b[1] - a[1]).forEach(([reason, count]) => console.log(`  ${reason}: ${count}x (${(count / r.trades.length * 100).toFixed(1)}%)`));
}

main();
