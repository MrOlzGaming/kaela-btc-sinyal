const { getExposure, getEffectiveExposure, getDynamicRiskPerTrade } = require('./moneyManagement');

const candles = require('./yahoo-btc-ohlc.json');
const STOP_PCT = 0.45;
const LEVERAGE = Math.floor(1 / STOP_PCT); // 2x

// Hari-ke-puncak historis TERDOKUMENTASI dari riset (bukan dari data kita, biar independen):
// Cycle 1 (halving 2012-11-28): puncak 368 hari kemudian
// Cycle 2 (halving 2016-07-09): puncak 526 hari kemudian
// Cycle 3 (halving 2020-05-11): puncak 549 hari kemudian
const KNOWN_DAYS_TO_PEAK = { cycle1: 368, cycle2: 526, cycle3: 549 };

const HALVINGS = [
  { label: 'Cycle 2 (halving 2016)', date: '2016-07-09', priorDaysToTop: [KNOWN_DAYS_TO_PEAK.cycle1] },
  { label: 'Cycle 3 (halving 2020)', date: '2020-05-11', priorDaysToTop: [KNOWN_DAYS_TO_PEAK.cycle1, KNOWN_DAYS_TO_PEAK.cycle2] },
  { label: 'Cycle 4 (halving 2024)', date: '2024-04-19', priorDaysToTop: [KNOWN_DAYS_TO_PEAK.cycle1, KNOWN_DAYS_TO_PEAK.cycle2, KNOWN_DAYS_TO_PEAK.cycle3] },
];

function idxNear(dateStr) {
  const t = new Date(dateStr).getTime();
  return candles.findIndex((c) => c.time >= t);
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

let balance = 100;
let totalDeposited = 100;
let peak = 100;
let maxDD = 0;
const trades = [];

for (const h of HALVINGS) {
  const buyIdx = idxNear(h.date);
  const walkForwardDays = Math.round(avg(h.priorDaysToTop)); // ATURAN cuma dari siklus SEBELUMNYA, bukan siklus ini sendiri
  const sellDate = new Date(new Date(h.date).getTime() + walkForwardDays * 24 * 3600 * 1000);
  let sellIdx = idxNear(sellDate.toISOString());
  if (sellIdx === -1) sellIdx = candles.length - 1; // kalau tanggal jual di masa depan data, pakai candle terakhir

  const entry = candles[buyIdx].close;
  const stopPrice = entry * (1 - STOP_PCT);

  const baseExposure = getExposure(balance);
  const exposure = getEffectiveExposure(baseExposure, LEVERAGE);
  const riskPerTradePct = getDynamicRiskPerTrade(balance);
  const capitalAtRisk = balance * riskPerTradePct;

  let exitIdx = sellIdx;
  let exitPrice = candles[sellIdx].close;
  let stopped = false;
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
    label: h.label,
    buyDate: h.date,
    walkForwardDays,
    sellDate: new Date(candles[exitIdx].time).toISOString().slice(0, 10),
    entry, exit: exitPrice, stopped,
    exposure, capitalAtRisk, balanceBefore, balanceAfter: balance,
  });
}

console.log('=== SIKLUS HALVING WALK-FORWARD (aturan jual dari rata-rata siklus SEBELUMNYA, bukan nyontek siklus sendiri) ===\n');
for (const t of trades) {
  console.log(`${t.label}`);
  console.log(`  Beli ${t.buyDate} @ $${t.entry.toFixed(0)} | Aturan jual: ${t.walkForwardDays} hari kemudian (dari rata-rata siklus sebelumnya) = ${t.sellDate}`);
  console.log(`  Keluar @ $${t.exit.toFixed(0)} ${t.stopped ? '(KENA STOP -45%)' : '(sesuai jadwal)'}`);
  console.log(`  Saldo: $${t.balanceBefore.toFixed(0)} -> $${t.balanceAfter.toFixed(0)}\n`);
}

const totalReturn = ((balance - totalDeposited) / totalDeposited) * 100;
const years = (candles[candles.length - 1].time - new Date('2016-07-09').getTime()) / (365.25 * 24 * 3600 * 1000);
const cagr = (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;
console.log(`Saldo akhir: $${balance.toFixed(0)} | Return: ${totalReturn.toFixed(1)}% | CAGR: ${cagr.toFixed(1)}%/th | Max DD (realisasi): ${(maxDD * 100).toFixed(1)}%`);
