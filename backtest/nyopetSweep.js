// Sweep sistematis mode Nyopet — cari kombinasi Nyawa x Stake x Timeframe terbaik.
// Long-only, TP 1:3, Weekly harus konfirmasi BULLISH, stake selalu % saldo TERBARU (compound otomatis).

const { superTrend } = require('./indicators');
const { adaptiveSuperTrend } = require('./adaptiveSuperTrend');
const { getExposure, getEffectiveExposure, computeLeverage } = require('./moneyManagement');

const weekly = require('./weekly-cache.json');
const timeframes = {
  'Daily+Weekly': require('./daily-cache.json'),
  '4H+Weekly': require('./h4-cache.json'),
  'Hourly+Weekly': require('./hourly-cache.json'),
};

function findAlignedIndex(weeklyCandles, targetTime) {
  let lo = 0, hi = weeklyCandles.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (weeklyCandles[mid].closeTime <= targetTime) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const weeklyTrend = superTrend(weekly, 10, 3);

function runOne(candles, adaptive, NYAWA_PCT, STAKE_PCT, RR) {
  const LEVERAGE = computeLeverage(NYAWA_PCT);
  const STARTING_BALANCE = 10;
  let balance = STARTING_BALANCE;
  let peak = STARTING_BALANCE, maxDD = 0;
  let position = null;
  let tradeCount = 0, wins = 0;

  for (let i = 1; i < candles.length; i++) {
    if (!adaptive[i].trend) continue;
    const c = candles[i];
    const flippedBullish = adaptive[i].trend === 'BULLISH' && adaptive[i - 1].trend === 'BEARISH';

    if (position) {
      const hitSL = c.low <= position.slPrice;
      const hitTP = c.high >= position.tpPrice;
      if (hitSL || hitTP) {
        const priceMovePct = hitTP ? NYAWA_PCT * RR : -NYAWA_PCT;
        const pnlDollar = position.stakeUsed * position.exposure * priceMovePct;
        balance += pnlDollar;
        peak = Math.max(peak, balance); maxDD = Math.max(maxDD, (peak - balance) / peak);
        tradeCount++;
        if (pnlDollar > 0) wins++;
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
    position = { entry, slPrice, tpPrice, stakeUsed: stake, exposure };
  }

  const years = 9;
  const totalReturn = (balance / STARTING_BALANCE) - 1;
  const cagr = (Math.pow(Math.max(0.0001, 1 + totalReturn), 1 / years) - 1) * 100;
  return { trades: tradeCount, winrate: tradeCount ? (wins / tradeCount * 100) : 0, balance, cagr, maxDD: maxDD * 100 };
}

const nyawaOptions = [0.02, 0.03, 0.05, 0.07, 0.10, 0.15, 0.20];
const stakeOptions = [0.02, 0.05, 0.10, 0.15, 0.20];
const rrOptions = [2, 3, 4];

const results = [];
for (const [label, candles] of Object.entries(timeframes)) {
  const adaptive = adaptiveSuperTrend(candles);
  for (const nyawa of nyawaOptions) {
    for (const stake of stakeOptions) {
      for (const rr of rrOptions) {
        const r = runOne(candles, adaptive, nyawa, stake, rr);
        if (r.trades >= 20) { // filter sample minimal biar gak nipu
          results.push({ label, nyawa, stake, rr, ...r });
        }
      }
    }
  }
}

console.log(`Total kombinasi diuji: ${timeframes ? Object.keys(timeframes).length * nyawaOptions.length * stakeOptions.length * rrOptions.length : 0}, lolos filter (>=20 trade): ${results.length}\n`);

results.sort((a, b) => b.cagr - a.cagr);

console.log('=== TOP 15 by CAGR (syarat minimal 20 trade) ===');
console.log('Timeframe        Nyawa  Stake  RR  Trades  Winrate  CAGR      MaxDD');
for (const r of results.slice(0, 15)) {
  console.log(
    r.label.padEnd(16), (r.nyawa*100)+'%'.padEnd(4), '  ', (r.stake*100)+'%'.padEnd(4), '  ', ('1:'+r.rr).padEnd(3),
    String(r.trades).padEnd(7), r.winrate.toFixed(1).padEnd(8)+'%', r.cagr.toFixed(1).padEnd(9)+'%/th', r.maxDD.toFixed(1)+'%'
  );
}

console.log('\n=== TOP 10 by CAGR, SYARAT Max DD <= 50% ===');
const safer = results.filter(r => r.maxDD <= 50).sort((a,b) => b.cagr - a.cagr);
console.log('Timeframe        Nyawa  Stake  RR  Trades  Winrate  CAGR      MaxDD');
for (const r of safer.slice(0, 10)) {
  console.log(
    r.label.padEnd(16), (r.nyawa*100)+'%'.padEnd(4), '  ', (r.stake*100)+'%'.padEnd(4), '  ', ('1:'+r.rr).padEnd(3),
    String(r.trades).padEnd(7), r.winrate.toFixed(1).padEnd(8)+'%', r.cagr.toFixed(1).padEnd(9)+'%/th', r.maxDD.toFixed(1)+'%'
  );
}
