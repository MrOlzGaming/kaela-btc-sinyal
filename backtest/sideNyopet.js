// SIDE TRADING "NYOPET" — modal super mini, TERPISAH TOTAL dari Siklus Halving.
// Sinyal: Weekly & Hourly Adaptive SuperTrend HARUS SEARAH (dua-duanya BUY atau dua-duanya SELL).
// Nyawa tetap 1% (SL fix). TP bertingkat RR 1:1 / 1:2 / 1:3 (scale-out 1/3 tiap TP kena).
// Modal per-entry (STAKE) = 1% saldo, di-compound tiap menang (stake + untung jadi stake trade
// berikutnya) sampai stake nyentuh 7.5% saldo (tengah rentang 5-10%), baru reset ke 1% saldo terbaru.

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

const NYAWA_PCT = 0.01; // 1% tetap, gak berubah
const LEVERAGE = computeLeverage(NYAWA_PCT); // 100x
const SIDE_STARTING_BALANCE = 10;
const STAKE_PCT = 0.01; // modal per-entry = 1% saldo
const RESET_THRESHOLD_PCT = 0.075; // begitu stake nyentuh 7.5% saldo (tengah 5-10%), reset ke 1% saldo terbaru

let balance = SIDE_STARTING_BALANCE;
let stake = balance * STAKE_PCT; // modal aktif buat entry berikutnya (bisa membesar krn compound)
let peak = SIDE_STARTING_BALANCE, maxDD = 0;
let position = null;
const trades = [];
const signalLog = [];
let infoCount = 0;
let resetCount = 0;

function closeTradeBookkeeping(tradePnlDollar) {
  // compound: stake baru = stake lama + untung/rugi trade ini
  const newStake = stake + tradePnlDollar;
  if (tradePnlDollar > 0 && newStake >= balance * RESET_THRESHOLD_PCT) {
    stake = balance * STAKE_PCT; // reset ke 1% saldo TERBARU (udah termasuk kenaikan dari trade ini)
    resetCount++;
  } else if (tradePnlDollar <= 0) {
    stake = balance * STAKE_PCT; // rugi -> reset juga ke 1% saldo terbaru (mulai fresh)
  } else {
    stake = newStake; // masih di bawah ambang reset, lanjut compound
  }
}

for (let i = 1; i < hourly.length; i++) {
  if (!hourlyAdaptive[i].trend) continue;
  const c = hourly[i];

  const flippedBearish = hourlyAdaptive[i].trend === 'BEARISH' && hourlyAdaptive[i - 1].trend === 'BULLISH';
  const flippedBullish = hourlyAdaptive[i].trend === 'BULLISH' && hourlyAdaptive[i - 1].trend === 'BEARISH';
  if (flippedBearish || flippedBullish) infoCount++;

  if (position) {
    const dir = position.direction;
    const hitSL = dir === 'BUY' ? c.low <= position.slPrice : c.high >= position.slPrice;
    if (hitSL) {
      const remainingFrac = 1 - position.stage / 3;
      const pnlDollar = position.stakeUsed * remainingFrac * position.exposure * -NYAWA_PCT;
      balance += pnlDollar;
      position.tradePnl += pnlDollar;
      peak = Math.max(peak, balance); maxDD = Math.max(maxDD, (peak - balance) / peak);
      trades.push({ ...position, exitDate: new Date(c.closeTime).toISOString(), result: 'SL', balanceAfter: balance });
      signalLog.push({ date: c.closeTime, type: 'SL', direction: dir, balance });
      closeTradeBookkeeping(position.tradePnl);
      position = null;
      continue;
    }
    const nextTpPrice = position.tp[position.stage];
    const hitTp = dir === 'BUY' ? c.high >= nextTpPrice : c.low <= nextTpPrice;
    if (hitTp) {
      const fracClosed = 1 / 3;
      const rr = position.stage + 1;
      const pnlDollar = position.stakeUsed * fracClosed * position.exposure * (NYAWA_PCT * rr);
      balance += pnlDollar;
      position.tradePnl += pnlDollar;
      peak = Math.max(peak, balance); maxDD = Math.max(maxDD, (peak - balance) / peak);
      signalLog.push({ date: c.closeTime, type: 'TP' + rr, direction: dir, balance });
      position.stage++;
      if (position.stage >= 3) {
        trades.push({ ...position, exitDate: new Date(c.closeTime).toISOString(), result: 'TP3_FULL', balanceAfter: balance });
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

  const baseExposure = getExposure(balance); // tier kekayaan tetap dari SALDO TOTAL
  const exposure = getEffectiveExposure(baseExposure, LEVERAGE);

  position = {
    direction, entry, slPrice, tp, stage: 0, tradePnl: 0,
    entryDate: new Date(c.closeTime).toISOString(),
    stakeUsed: stake, exposure,
  };
  signalLog.push({ date: c.closeTime, type: 'ENTRY', direction, stake, balance });
}

const slCount = trades.filter((t) => t.result === 'SL').length;
const fullTpCount = trades.filter((t) => t.result === 'TP3_FULL').length;

console.log('=== SIDE TRADING "NYOPET" — Stake 1% compound sampai 7.5%, reset, Nyawa 1%, TP RR1-3 ===\n');
console.log('Periode:', new Date(hourly[0].closeTime).toISOString().slice(0, 10), '-', new Date(hourly[hourly.length - 1].closeTime).toISOString().slice(0, 10));
console.log('Total sinyal hourly muncul (info):', infoCount);
console.log('Total entry (Weekly+Hourly searah):', trades.length + (position ? 1 : 0));
console.log('Trade selesai kena SL:', slCount, '| Trade selesai full TP3:', fullTpCount);
console.log('Berapa kali stake reset (nyentuh 7.5%):', resetCount);
console.log('Leverage tetap:', LEVERAGE + 'x (dari Nyawa 1%)');
console.log('Modal awal: $' + SIDE_STARTING_BALANCE, '| Saldo akhir: $' + balance.toFixed(2));
console.log('Return:', (((balance / SIDE_STARTING_BALANCE) - 1) * 100).toFixed(1) + '%');
console.log('Max Drawdown:', (maxDD * 100).toFixed(1) + '%');
console.log('\n=== 20 event pertama ===');
for (const s of signalLog.slice(0, 20)) {
  console.log(new Date(s.date).toISOString().slice(0, 16), '|', s.type.padEnd(6), '|', s.direction, '| saldo $' + s.balance.toFixed(3));
}
