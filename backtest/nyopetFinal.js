// Simulasi detail lengkap — SPESIFIKASI FINAL Nyopet (hasil sweep, lihat nyopetLog.js header).
// Hourly+Weekly, Long-only, Nyawa 10%, TP tunggal RR 1:2, Stake 15% saldo terbaru (compound).

const { superTrend } = require('./indicators');
const { adaptiveSuperTrend } = require('./adaptiveSuperTrend');
const { getExposure, getEffectiveExposure, computeLeverage } = require('./moneyManagement');

const hourly = require('./hourly-cache.json');
const weekly = require('./weekly-cache.json');

function findAlignedIndex(weeklyCandles, targetTime) {
  let lo = 0, hi = weeklyCandles.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (weeklyCandles[mid].closeTime <= targetTime) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const weeklyTrend = superTrend(weekly, 10, 3);
const hourlyAdaptive = adaptiveSuperTrend(hourly);

const NYAWA_PCT = 0.10;
const RR = 2;
const LEVERAGE = computeLeverage(NYAWA_PCT);
const STARTING_BALANCE = 10;
const STAKE_PCT = 0.15;

let balance = STARTING_BALANCE;
let peak = STARTING_BALANCE, maxDD = 0;
let position = null;
const trades = [];

for (let i = 1; i < hourly.length; i++) {
  if (!hourlyAdaptive[i].trend) continue;
  const c = hourly[i];
  const flippedBullish = hourlyAdaptive[i].trend === 'BULLISH' && hourlyAdaptive[i - 1].trend === 'BEARISH';

  if (position) {
    const hitSL = c.low <= position.slPrice;
    const hitTP = c.high >= position.tpPrice;
    if (hitSL || hitTP) {
      const priceMovePct = hitTP ? NYAWA_PCT * RR : -NYAWA_PCT;
      const pnlDollar = position.stakeUsed * position.exposure * priceMovePct;
      balance += pnlDollar;
      peak = Math.max(peak, balance);
      maxDD = Math.max(maxDD, (peak - balance) / peak);
      trades.push({
        entryDate: position.entryDate, exitDate: new Date(c.closeTime).toISOString(),
        entry: position.entry, endedBy: hitTP ? 'TP' : 'SL', pnlDollar, balanceAfter: balance,
      });
      position = null;
    }
    continue;
  }

  if (!flippedBullish) continue;
  if (balance <= 0.01) break;
  const weeklyIdx = findAlignedIndex(weekly, c.closeTime);
  if (weeklyIdx === -1 || !weeklyTrend[weeklyIdx].trend) continue;
  if (weeklyTrend[weeklyIdx].trend !== 'BULLISH') continue;

  const entry = c.close;
  const slPrice = entry * (1 - NYAWA_PCT);
  const tpPrice = entry * (1 + NYAWA_PCT * RR);
  const baseExposure = getExposure(balance);
  const exposure = getEffectiveExposure(baseExposure, LEVERAGE);
  const stake = balance * STAKE_PCT;
  position = {
    entry, slPrice, tpPrice, stakeUsed: stake, exposure,
    entryDate: new Date(c.closeTime).toISOString(),
  };
}

const years = 9;
const totalReturn = (balance / STARTING_BALANCE) - 1;
const cagr = (Math.pow(Math.max(0.0001, 1 + totalReturn), 1 / years) - 1) * 100;
const wins = trades.filter((t) => t.pnlDollar > 0).length;

console.log('=== NYOPET — SPESIFIKASI FINAL (dipilih dari sweep 315 kombinasi) ===\n');
console.log(`Timeframe : Hourly + Weekly | Arah: LONG-ONLY`);
console.log(`Nyawa (SL): ${NYAWA_PCT * 100}% -> Leverage ${LEVERAGE}x | TP: RR 1:${RR} | Stake: ${STAKE_PCT * 100}% saldo terbaru\n`);
console.log(`Total trade   : ${trades.length}`);
console.log(`Win / Lose    : ${wins} / ${trades.length - wins} (winrate ${(wins / trades.length * 100).toFixed(1)}%)`);
console.log(`Saldo awal    : $${STARTING_BALANCE}`);
console.log(`Saldo akhir   : $${balance.toFixed(2)}`);
console.log(`Total return  : ${(totalReturn * 100).toFixed(1)}%`);
console.log(`CAGR (9 th)   : ${cagr.toFixed(1)}%/tahun`);
console.log(`Max Drawdown  : ${(maxDD * 100).toFixed(1)}%`);

console.log('\n=== Perbandingan vs Siklus Halving (strategi utama) ===');
console.log('Siklus Halving : CAGR 73,8%/tahun | Max DD 0%');
console.log(`Nyopet (final) : CAGR ${cagr.toFixed(1)}%/tahun | Max DD ${(maxDD * 100).toFixed(1)}%`);
console.log('-> Nyopet TETAP jauh di bawah & jauh lebih berisiko. Statusnya side-experiment, bukan pesaing.');

console.log('\n=== 15 trade pertama (bukti jejak) ===');
for (const t of trades.slice(0, 15)) {
  console.log(
    t.entryDate.slice(0, 16), '| entry', t.entry.toFixed(0), '|', t.endedBy.padEnd(2),
    '| pnl', (t.pnlDollar >= 0 ? '+' : '') + t.pnlDollar.toFixed(3), '| saldo $' + t.balanceAfter.toFixed(3)
  );
}
