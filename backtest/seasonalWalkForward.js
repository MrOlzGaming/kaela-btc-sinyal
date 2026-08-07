const { getExposure, getEffectiveExposure, getDynamicRiskPerTrade, computeLeverage } = require('./moneyManagement');
const candles = require('./yahoo-btc-ohlc.json');

// Pola ditentukan HANYA dari data 2014-2021 (lihat analisis sebelumnya) -- walk-forward, tidak nyontek 2022-2026
const LONG_MONTHS = [2, 4, 7, 10, 11]; // Feb, Apr, Jul, Okt, Nov (winrate >=60% s/d 2021)
const SHORT_MONTHS = [1, 3, 8, 9]; // Jan, Mar, Agu, Sep (winrate <=35% s/d 2021)
const LONG_STOP = 0.40;
const SHORT_STOP = 0.80;
const SHORT_SIZE_MULT = 0.25; // short dapet porsi lebih kecil dari long, bukan 1% (nyaris nol), tapi tetap dikurangi

function monthCandles(year, month) {
  return candles.filter((c) => {
    const d = new Date(c.time);
    return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
  });
}

function runFrom(startYear) {
  let balance = 100;
  let totalDeposited = 100;
  let peak = 100, maxDD = 0;
  const trades = [];

  for (let year = startYear; year <= 2026; year++) {
    for (let month = 1; month <= 12; month++) {
      const isLong = LONG_MONTHS.includes(month);
      const isShort = SHORT_MONTHS.includes(month);
      if (!isLong && !isShort) continue;

      const mc = monthCandles(year, month);
      if (mc.length < 5) continue;

      const direction = isLong ? 'LONG' : 'SHORT';
      const stopPct = isLong ? LONG_STOP : SHORT_STOP;
      const leverage = computeLeverage(stopPct);
      const entry = mc[0].close;
      const stopPrice = direction === 'LONG' ? entry * (1 - stopPct) : entry * (1 + stopPct);

      const baseExposure = getExposure(balance);
      const exposure = getEffectiveExposure(baseExposure, leverage);
      let riskPerTradePct = getDynamicRiskPerTrade(balance);
      if (direction === 'SHORT') riskPerTradePct *= SHORT_SIZE_MULT; // short: porsi dikecilin, bukan full
      const capitalAtRisk = balance * riskPerTradePct;

      let exitPrice = mc[mc.length - 1].close;
      let stopped = false;
      for (const c of mc) {
        if (direction === 'LONG' && c.low <= stopPrice) { exitPrice = stopPrice; stopped = true; break; }
        if (direction === 'SHORT' && c.high >= stopPrice) { exitPrice = stopPrice; stopped = true; break; }
      }

      const priceMovePct = direction === 'LONG' ? (exitPrice - entry) / entry : (entry - exitPrice) / entry;
      const growthPct = exposure * priceMovePct;
      const pnlDollar = capitalAtRisk * growthPct;
      const balanceBefore = balance;
      balance = balance + pnlDollar;
      peak = Math.max(peak, balance);
      maxDD = Math.max(maxDD, (peak - balance) / peak);

      trades.push({ year, month, direction, entry, exit: exitPrice, stopped, balanceBefore, balanceAfter: balance });
    }
  }

  const wins = trades.filter((t) => t.balanceAfter > t.balanceBefore).length;
  const totalReturn = ((balance - totalDeposited) / totalDeposited) * 100;
  const years = 2026 - startYear + 1;
  const cagr = (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;
  return { trades, wins, balance, totalReturn, cagr, maxDD: maxDD * 100 };
}

console.log('=== FULL PERIOD (2015-2026), sizing asimetris (short = 25% dari porsi long) ===');
const full = runFrom(2015);
console.log(`trades=${full.trades.length} win=${full.wins} (${(full.wins/full.trades.length*100).toFixed(1)}%) return=${full.totalReturn.toFixed(1)}% CAGR=${full.cagr.toFixed(1)}%/th maxDD=${full.maxDD.toFixed(1)}%\n`);

console.log('=== OUT-OF-SAMPLE murni (2022-2026, pola musiman ditentukan dari data SEBELUM ini) ===');
const oos = runFrom(2022);
for (const t of oos.trades) {
  const mn = ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][t.month];
  console.log(`${t.year}-${mn} | ${t.direction.padEnd(5)} | $${t.entry.toFixed(0)}->$${t.exit.toFixed(0)} ${t.stopped?'(STOP)':''} | saldo $${t.balanceBefore.toFixed(0)}->$${t.balanceAfter.toFixed(0)}`);
}
console.log(`\ntrades=${oos.trades.length} win=${oos.wins} (${(oos.wins/oos.trades.length*100).toFixed(1)}%) return=${oos.totalReturn.toFixed(1)}% CAGR=${oos.cagr.toFixed(1)}%/th maxDD=${oos.maxDD.toFixed(1)}%`);
