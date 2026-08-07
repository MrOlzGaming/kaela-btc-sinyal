// SIDE TRADING (terpisah total dari Siklus Halving) — modal super mini.
// Sinyal: Weekly trend BEARISH + Hourly Adaptive SuperTrend baru flip ke BEARISH -> entry SHORT.
// Exit: begitu Hourly Adaptive SuperTrend flip balik ke BULLISH (garis ST = trailing stop alami).

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

const SIDE_STARTING_BALANCE = 10; // modal super mini, TERPISAH dari Siklus Halving
let balance = SIDE_STARTING_BALANCE;
let peak = SIDE_STARTING_BALANCE, maxDD = 0;
let position = null;
const trades = [];
let infoCount = 0; // hitung berapa kali sinyal hourly muncul (info doang, gak semua jadi trade)

for (let i = 1; i < hourly.length; i++) {
  if (!hourlyAdaptive[i].trend) continue;

  const flippedBearish = hourlyAdaptive[i].trend === 'BEARISH' && hourlyAdaptive[i - 1].trend === 'BULLISH';
  const flippedBullish = hourlyAdaptive[i].trend === 'BULLISH' && hourlyAdaptive[i - 1].trend === 'BEARISH';
  if (flippedBearish || flippedBullish) infoCount++;

  if (position) {
    if (flippedBullish) {
      const exitPrice = hourly[i].close;
      const priceMovePct = (position.entry - exitPrice) / position.entry;
      const growthPct = position.exposure * priceMovePct;
      const pnlDollar = position.capitalAtRisk * growthPct;
      balance += pnlDollar;
      peak = Math.max(peak, balance);
      maxDD = Math.max(maxDD, (peak - balance) / peak);
      trades.push({
        entryDate: position.entryDate, exitDate: new Date(hourly[i].closeTime).toISOString(),
        entry: position.entry, exit: exitPrice, result: pnlDollar >= 0 ? 'WIN' : 'LOSS',
        pnlDollar, balanceAfter: balance,
      });
      position = null;
    }
    continue;
  }

  if (!flippedBearish) continue;
  const weeklyIdx = findAlignedIndex(weekly, hourly[i].closeTime);
  if (weeklyIdx === -1 || !weeklyTrend[weeklyIdx].trend) continue;
  if (weeklyTrend[weeklyIdx].trend !== 'BEARISH') continue; // syarat: weekly juga bearish

  const entry = hourly[i].close;
  const stopPrice = hourlyAdaptive[i].value; // garis ST = SL alami
  const riskDistance = Math.abs(stopPrice - entry) / entry;
  if (riskDistance <= 0 || riskDistance > 0.9) continue; // guard, hindari radius aneh

  const leverage = computeLeverage(riskDistance);
  const baseExposure = getExposure(balance);
  const exposure = getEffectiveExposure(baseExposure, leverage);
  const capitalAtRisk = balance; // modal super mini, dianggap 100% dipakai (nilainya kecil banget)

  position = {
    entry, entryDate: new Date(hourly[i].closeTime).toISOString(),
    riskDistance, leverage, exposure, capitalAtRisk,
  };
}

const wins = trades.filter((t) => t.result === 'WIN').length;
const losses = trades.filter((t) => t.result === 'LOSS').length;

console.log('=== SIDE TRADING: Weekly Bearish + Hourly Adaptive SuperTrend Short ===\n');
console.log('Periode data hourly:', new Date(hourly[0].closeTime).toISOString().slice(0, 10), '-', new Date(hourly[hourly.length - 1].closeTime).toISOString().slice(0, 10));
console.log('Total sinyal hourly muncul (info, gak semua jadi trade):', infoCount);
console.log('Total trade yang MEMENUHI syarat (Weekly bearish + Hourly bearish):', trades.length);
console.log('Win/Loss:', wins + '/' + losses, '| Winrate:', trades.length ? (wins / trades.length * 100).toFixed(1) + '%' : '-');
console.log('Modal awal: $' + SIDE_STARTING_BALANCE, '| Saldo akhir: $' + balance.toFixed(2));
console.log('Return:', (((balance / SIDE_STARTING_BALANCE) - 1) * 100).toFixed(1) + '%');
console.log('Max Drawdown:', (maxDD * 100).toFixed(1) + '%');
console.log('\n=== 10 trade pertama (contoh) ===');
for (const t of trades.slice(0, 10)) {
  console.log(t.entryDate.slice(0, 16), '->', t.exitDate.slice(0, 16), '|', t.result, '| saldo ->', '$' + t.balanceAfter.toFixed(2));
}
