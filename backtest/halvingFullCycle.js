const { getExposure, getEffectiveExposure, getDynamicRiskPerTrade } = require('./moneyManagement');
const candles = require('./yahoo-btc-ohlc.json');

const LONG_STOP_PCT = 0.45;
const SHORT_STOP_PCT = 0.45; // jarak stop buat posisi short (harga naik X% dari entry short = kena stop)
const LONG_LEVERAGE = Math.floor(1 / LONG_STOP_PCT);
const SHORT_LEVERAGE = Math.floor(1 / SHORT_STOP_PCT);

const HALVINGS = ['2016-07-09', '2020-05-11', '2024-04-19'];
// walk-forward: rata2 dari siklus SEBELUMNYA aja
const DAYS_AFTER_HALVING_TO_PEAK = { prior1: [368], prior2: [368, 526], prior3: [368, 526, 549] };
const DAYS_BEFORE_HALVING_BOTTOM = { prior1: [542], prior2: [542, 513] }; // buat siklus ke-3 (bottom sblm halving ke-3 = 2024), pakai avg 2 data sebelumnya

function idxAt(dateMs) {
  return candles.findIndex((c) => c.time >= dateMs);
}
function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function runLeg(direction, buyIdx, sellIdx, balance, stopPct, leverage) {
  const entry = candles[buyIdx].close;
  const stopPrice = direction === 'LONG' ? entry * (1 - stopPct) : entry * (1 + stopPct);
  const baseExposure = getExposure(balance);
  const exposure = getEffectiveExposure(baseExposure, leverage);
  const riskPerTradePct = getDynamicRiskPerTrade(balance);
  const capitalAtRisk = balance * riskPerTradePct;

  let exitIdx = sellIdx, exitPrice = candles[sellIdx].close, stopped = false;
  for (let i = buyIdx; i <= sellIdx; i++) {
    if (direction === 'LONG' && candles[i].low <= stopPrice) { exitIdx = i; exitPrice = stopPrice; stopped = true; break; }
    if (direction === 'SHORT' && candles[i].high >= stopPrice) { exitIdx = i; exitPrice = stopPrice; stopped = true; break; }
  }

  const priceMovePct = direction === 'LONG' ? (exitPrice - entry) / entry : (entry - exitPrice) / entry;
  const growthPct = exposure * priceMovePct;
  const pnlDollar = capitalAtRisk * growthPct;
  const newBalance = balance + pnlDollar;

  return {
    direction, entry, exit: exitPrice, stopped, exposure, leverage, capitalAtRisk,
    buyDate: new Date(candles[buyIdx].time).toISOString().slice(0, 10),
    sellDate: new Date(candles[exitIdx].time).toISOString().slice(0, 10),
    balanceBefore: balance, balanceAfter: newBalance, exitIdx,
  };
}

let balance = 100;
let peak = 100, maxDD = 0;
const legs = [];

// Cycle 2016: LONG dari halving -> peak (walk-forward dari cycle 2012 aja)
let h0 = new Date(HALVINGS[0]).getTime();
let peakDays0 = Math.round(avg(DAYS_AFTER_HALVING_TO_PEAK.prior1));
let peakIdx0 = idxAt(h0 + peakDays0 * 86400000);
let leg = runLeg('LONG', idxAt(h0), peakIdx0, balance, LONG_STOP_PCT, LONG_LEVERAGE);
legs.push({ cycle: '2016 LONG (halving->peak)', ...leg }); balance = leg.balanceAfter;

// SHORT dari peak siklus 2016 -> bottom sblm halving 2020 (walk-forward dari cycle 2012 bottom aja)
let bottomDays1 = Math.round(avg(DAYS_BEFORE_HALVING_BOTTOM.prior1));
let h1 = new Date(HALVINGS[1]).getTime();
let bottomIdx1 = idxAt(h1 - bottomDays1 * 86400000);
leg = runLeg('SHORT', leg.exitIdx, bottomIdx1, balance, SHORT_STOP_PCT, SHORT_LEVERAGE);
legs.push({ cycle: '2016->2020 SHORT (peak->bottom)', ...leg }); balance = leg.balanceAfter;

// Cycle 2020: LONG dari bottom -> peak (walk-forward dari cycle 2012+2016)
let peakDays1 = Math.round(avg(DAYS_AFTER_HALVING_TO_PEAK.prior2));
let peakIdx1 = idxAt(h1 + peakDays1 * 86400000);
leg = runLeg('LONG', leg.exitIdx, peakIdx1, balance, LONG_STOP_PCT, LONG_LEVERAGE);
legs.push({ cycle: '2020 LONG (bottom->peak)', ...leg }); balance = leg.balanceAfter;

// SHORT dari peak 2020 -> bottom sblm halving 2024 (walk-forward dari cycle 2012+2016 bottom)
let bottomDays2 = Math.round(avg(DAYS_BEFORE_HALVING_BOTTOM.prior2));
let h2 = new Date(HALVINGS[2]).getTime();
let bottomIdx2 = idxAt(h2 - bottomDays2 * 86400000);
leg = runLeg('SHORT', leg.exitIdx, bottomIdx2, balance, SHORT_STOP_PCT, SHORT_LEVERAGE);
legs.push({ cycle: '2020->2024 SHORT (peak->bottom)', ...leg }); balance = leg.balanceAfter;

// Cycle 2024: LONG dari bottom -> peak (walk-forward dari 3 cycle sebelumnya)
let peakDays2 = Math.round(avg(DAYS_AFTER_HALVING_TO_PEAK.prior3));
let peakIdx2 = idxAt(h2 + peakDays2 * 86400000);
if (peakIdx2 === -1) peakIdx2 = candles.length - 1;
leg = runLeg('LONG', leg.exitIdx, peakIdx2, balance, LONG_STOP_PCT, LONG_LEVERAGE);
legs.push({ cycle: '2024 LONG (bottom->peak)', ...leg }); balance = leg.balanceAfter;

for (const l of legs) {
  peak = Math.max(peak, l.balanceAfter);
  maxDD = Math.max(maxDD, (peak - l.balanceAfter) / peak);
}

console.log('=== FULL SIKLUS: LONG (halving->puncak) + SHORT (puncak->bottom siklus berikut), semua walk-forward ===\n');
for (const l of legs) {
  console.log(`${l.cycle}: ${l.direction} ${l.buyDate} @$${l.entry.toFixed(0)} -> ${l.sellDate} @$${l.exit.toFixed(0)} ${l.stopped ? '(KENA STOP)' : '(jadwal)'}`);
  console.log(`  exposure=${l.exposure}x lev=${l.leverage}x capitalAtRisk=$${l.capitalAtRisk.toFixed(0)} | saldo $${l.balanceBefore.toFixed(0)} -> $${l.balanceAfter.toFixed(0)}\n`);
}

const totalDeposited = 100;
const totalReturn = ((balance - totalDeposited) / totalDeposited) * 100;
const years = (candles[candles.length - 1].time - new Date('2016-07-09').getTime()) / (365.25 * 86400000);
const cagr = (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;
console.log(`Saldo akhir: $${balance.toFixed(0)} | Return: ${totalReturn.toFixed(1)}% | CAGR: ${cagr.toFixed(1)}%/th | Max DD: ${(maxDD * 100).toFixed(1)}%`);
