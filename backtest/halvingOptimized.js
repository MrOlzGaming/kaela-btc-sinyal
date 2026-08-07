const { getExposure, getEffectiveExposure, getDynamicRiskPerTrade, computeLeverage } = require('./moneyManagement');
const candles = require('./yahoo-btc-ohlc.json');

const STOP_PCT = 0.30; // buffer di atas worst historis 20.6%
const LEVERAGE = computeLeverage(STOP_PCT); // 3x

const HALVINGS = ['2016-07-09', '2020-05-11', '2024-04-19'];
const DAYS_BEFORE_TO_BOTTOM = { prior1: [542], prior2: [542, 513], prior3: [542, 513, 515] };
const DAYS_AFTER_TO_PEAK = { prior1: [368], prior2: [368, 526], prior3: [368, 526, 549] };

function idxAt(ms) { return candles.findIndex((c) => c.time >= ms); }
function avg(arr) { return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length); }

let balance = 100;
let totalDeposited = 100;
let peak = 100, maxDD = 0;
const trades = [];

const cycles = [
  { label: 'Cycle 2016 (halving 2016-07-09)', h: HALVINGS[0], before: avg(DAYS_BEFORE_TO_BOTTOM.prior1), after: avg(DAYS_AFTER_TO_PEAK.prior1) },
  { label: 'Cycle 2020 (halving 2020-05-11)', h: HALVINGS[1], before: avg(DAYS_BEFORE_TO_BOTTOM.prior2), after: avg(DAYS_AFTER_TO_PEAK.prior2) },
  { label: 'Cycle 2024 (halving 2024-04-19)', h: HALVINGS[2], before: avg(DAYS_BEFORE_TO_BOTTOM.prior3), after: avg(DAYS_AFTER_TO_PEAK.prior3) },
];

for (const cyc of cycles) {
  const h = new Date(cyc.h).getTime();
  const buyIdx = idxAt(h - cyc.before * 86400000);
  let sellIdx = idxAt(h + cyc.after * 86400000);
  if (sellIdx === -1) sellIdx = candles.length - 1;

  const entry = candles[buyIdx].close;
  const stopPrice = entry * (1 - STOP_PCT);
  const baseExposure = getExposure(balance);
  const exposure = getEffectiveExposure(baseExposure, LEVERAGE);
  const riskPerTradePct = getDynamicRiskPerTrade(balance);
  const capitalAtRisk = balance * riskPerTradePct;

  let exitIdx = sellIdx, exitPrice = candles[sellIdx].close, stopped = false;
  for (let i = buyIdx; i <= sellIdx; i++) {
    if (candles[i].low <= stopPrice) { exitIdx = i; exitPrice = stopPrice; stopped = true; break; }
  }

  const priceMovePct = (exitPrice - entry) / entry;
  const growthPct = exposure * priceMovePct;
  const pnlDollar = capitalAtRisk * growthPct;
  const balanceBefore = balance;
  balance = balance + pnlDollar;
  peak = Math.max(peak, balance);
  maxDD = Math.max(maxDD, (peak - balance) / peak);

  trades.push({
    label: cyc.label,
    buyDate: new Date(candles[buyIdx].time).toISOString().slice(0, 10),
    sellDate: new Date(candles[exitIdx].time).toISOString().slice(0, 10),
    daysBefore: cyc.before, daysAfter: cyc.after,
    entry, exit: exitPrice, stopped, exposure, leverage: LEVERAGE, capitalAtRisk,
    balanceBefore, balanceAfter: balance,
  });
}

console.log('=== SIKLUS HALVING DIOPTIMALKAN: Beli dari BOTTOM walk-forward (bukan hari-H halving), Leverage 3x ===\n');
for (const t of trades) {
  console.log(`${t.label}`);
  console.log(`  Beli ${t.buyDate} @ $${t.entry.toFixed(0)} (${t.daysBefore} hari sblm halving, walk-forward)`);
  console.log(`  Jual ${t.sellDate} @ $${t.exit.toFixed(0)} (${t.daysAfter} hari stlh halving, walk-forward) ${t.stopped ? '(KENA STOP)' : '(sesuai jadwal)'}`);
  console.log(`  exposure=${t.exposure}x leverage=${t.leverage}x | saldo $${t.balanceBefore.toFixed(0)} -> $${t.balanceAfter.toFixed(0)}\n`);
}

const totalReturn = ((balance - totalDeposited) / totalDeposited) * 100;
const years = (candles[candles.length - 1].time - new Date('2015-01-14').getTime()) / (365.25 * 86400000);
const cagr = (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;
console.log(`Saldo akhir: $${balance.toFixed(2)} | Return: ${totalReturn.toFixed(1)}% | CAGR: ${cagr.toFixed(1)}%/th | Max DD: ${(maxDD * 100).toFixed(1)}%`);
