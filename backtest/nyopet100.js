// Simulasi detail 100 posisi pertama mode Nyopet — pakai spesifikasi final
// (Weekly+Hourly searah, Nyawa 1%, TP bertingkat RR1-3, stake 1% compound sampai 7.5% lalu reset).

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

const NYAWA_PCT = 0.01;
const LEVERAGE = computeLeverage(NYAWA_PCT); // 100x
const STARTING_BALANCE = 10;
const STAKE_PCT = 0.01;
const RESET_THRESHOLD_PCT = 0.075;
const TARGET_TRADES = 100;

let balance = STARTING_BALANCE;
let stake = balance * STAKE_PCT;
let position = null;
const trades = [];

function closeTradeBookkeeping(tradePnlDollar) {
  const newStake = stake + tradePnlDollar;
  if (tradePnlDollar > 0 && newStake >= balance * RESET_THRESHOLD_PCT) {
    stake = balance * STAKE_PCT;
  } else if (tradePnlDollar <= 0) {
    stake = balance * STAKE_PCT;
  } else {
    stake = newStake;
  }
}

for (let i = 1; i < hourly.length && trades.length < TARGET_TRADES; i++) {
  if (!hourlyAdaptive[i].trend) continue;
  const c = hourly[i];

  const flippedBearish = hourlyAdaptive[i].trend === 'BEARISH' && hourlyAdaptive[i - 1].trend === 'BULLISH';
  const flippedBullish = hourlyAdaptive[i].trend === 'BULLISH' && hourlyAdaptive[i - 1].trend === 'BEARISH';

  if (position) {
    const dir = position.direction;
    const hitSL = dir === 'BUY' ? c.low <= position.slPrice : c.high >= position.slPrice;
    if (hitSL) {
      const remainingFrac = 1 - position.tpHit / 3;
      const pnlDollar = position.stakeUsed * remainingFrac * position.exposure * -NYAWA_PCT;
      balance += pnlDollar;
      position.tradePnl += pnlDollar;
      trades.push({
        entryDate: position.entryDate, exitDate: new Date(c.closeTime).toISOString(),
        direction: dir, entry: position.entry, tpHit: position.tpHit, endedBy: 'SL',
        tradePnl: position.tradePnl, balanceAfter: balance,
      });
      closeTradeBookkeeping(position.tradePnl);
      position = null;
      continue;
    }
    const nextTpPrice = position.tp[position.tpHit];
    const hitTp = dir === 'BUY' ? c.high >= nextTpPrice : c.low <= nextTpPrice;
    if (hitTp) {
      const rr = position.tpHit + 1;
      const pnlDollar = position.stakeUsed * (1 / 3) * position.exposure * (NYAWA_PCT * rr);
      balance += pnlDollar;
      position.tradePnl += pnlDollar;
      position.tpHit++;
      if (position.tpHit >= 3) {
        trades.push({
          entryDate: position.entryDate, exitDate: new Date(c.closeTime).toISOString(),
          direction: dir, entry: position.entry, tpHit: 3, endedBy: 'TP3',
          tradePnl: position.tradePnl, balanceAfter: balance,
        });
        closeTradeBookkeeping(position.tradePnl);
        position = null;
      }
    }
    continue;
  }

  if (!flippedBearish && !flippedBullish) continue;
  const weeklyIdx = findAlignedIndex(weekly, c.closeTime);
  if (weeklyIdx === -1 || !weeklyTrend[weeklyIdx].trend) continue;

  const weeklyDir = weeklyTrend[weeklyIdx].trend;
  const hourlyDir = flippedBullish ? 'BULLISH' : 'BEARISH';
  if (weeklyDir !== hourlyDir) continue;

  const direction = hourlyDir === 'BULLISH' ? 'BUY' : 'SELL';
  const entry = c.close;
  const slPrice = direction === 'BUY' ? entry * (1 - NYAWA_PCT) : entry * (1 + NYAWA_PCT);
  const tp = [1, 2, 3].map((rr) => direction === 'BUY' ? entry * (1 + NYAWA_PCT * rr) : entry * (1 - NYAWA_PCT * rr));
  const baseExposure = getExposure(balance);
  const exposure = getEffectiveExposure(baseExposure, LEVERAGE);

  position = {
    direction, entry, slPrice, tp, tpHit: 0, tradePnl: 0,
    entryDate: new Date(c.closeTime).toISOString(),
    stakeUsed: stake, exposure,
  };
}

console.log(`=== SIMULASI ${trades.length} POSISI PERTAMA — MODE NYOPET (spesifikasi final) ===\n`);
console.log('stP: n/a | Leverage:', LEVERAGE + 'x | Stake: 1% saldo (compound s/d 7.5%, reset)\n');

const breakdown = { 0: 0, 1: 0, 2: 0, 3: 0 };
for (const t of trades) breakdown[t.tpHit]++;

console.log('=== Ringkasan hasil akhir tiap posisi (TP kena sebelum berhenti) ===');
console.log('0 TP kena (langsung SL)         :', breakdown[0], 'trade');
console.log('1 TP kena, sisanya SL           :', breakdown[1], 'trade');
console.log('2 TP kena, sisanya SL           :', breakdown[2], 'trade');
console.log('3 TP kena (tuntas, gak balik SL):', breakdown[3], 'trade');
console.log();

const wins = trades.filter((t) => t.tradePnl > 0).length;
const losses = trades.filter((t) => t.tradePnl <= 0).length;
console.log('Net untung (dari 100 posisi):', wins, '| Net rugi:', losses);
console.log('Saldo awal: $' + STARTING_BALANCE, '| Saldo setelah 100 posisi: $' + balance.toFixed(3));
console.log('Return:', (((balance / STARTING_BALANCE) - 1) * 100).toFixed(2) + '%');

console.log('\n=== Detail 20 posisi pertama ===');
for (const t of trades.slice(0, 20)) {
  const tpStr = [1, 2, 3].map((n) => (n <= t.tpHit ? '✅' : '❌')).join('');
  console.log(t.entryDate.slice(0, 16), t.direction.padEnd(4), '| TP:', tpStr, '| berhenti di:', t.endedBy.padEnd(3), '| saldo $' + t.balanceAfter.toFixed(4));
}
