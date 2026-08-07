const { getExposure, getEffectiveExposure, getDynamicRiskPerTrade, computeLeverage } = require('./moneyManagement');
const candles = require('./yahoo-btc-ohlc.json');

const LONG_MONTHS = [2, 4, 7, 10]; // Feb, Apr, Jul, Okt
const SHORT_MONTHS = [1, 8, 9]; // Jan, Agu, Sep
const LONG_STOP = 0.40; // buffer di atas worst historis 34.0%
const SHORT_STOP = 0.80; // buffer di atas worst historis 74.2%

function monthCandles(year, month) {
  return candles.filter((c) => {
    const d = new Date(c.time);
    return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
  });
}

let balance = 100;
let totalDeposited = 100;
let peak = 100, maxDD = 0;
const trades = [];

for (let year = 2015; year <= 2026; year++) {
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
    const riskPerTradePct = getDynamicRiskPerTrade(balance);
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

    trades.push({ year, month, direction, entry, exit: exitPrice, stopped, leverage, exposure, balanceBefore, balanceAfter: balance });
  }
}

const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
console.log('=== STRATEGI MUSIMAN: LONG di Feb/Apr/Jul/Okt, SHORT di Jan/Agu/Sep ===\n');
for (const t of trades) {
  console.log(`${t.year}-${monthNames[t.month]} | ${t.direction.padEnd(5)} | lev=${t.leverage}x | $${t.entry.toFixed(0)}->$${t.exit.toFixed(0)} ${t.stopped ? '(STOP)' : ''} | saldo $${t.balanceBefore.toFixed(0)}->$${t.balanceAfter.toFixed(0)}`);
}

const wins = trades.filter((t) => t.balanceAfter > t.balanceBefore).length;
const totalReturn = ((balance - totalDeposited) / totalDeposited) * 100;
const years = 11;
const cagr = (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;
console.log(`\nTotal trade: ${trades.length} | Win: ${wins} (${(wins / trades.length * 100).toFixed(1)}%)`);
console.log(`Saldo akhir: $${balance.toFixed(2)} | Return: ${totalReturn.toFixed(1)}% | CAGR: ${cagr.toFixed(1)}%/th | Max DD: ${(maxDD * 100).toFixed(1)}%`);
