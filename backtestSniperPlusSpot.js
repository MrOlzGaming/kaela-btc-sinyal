// Riset 22 Agu 2026 (permintaan Olan): sistem SAMA (Sniper+FVG, BTC+Emas) modal $100 + topup
// $100/bln SAMPAI $1.000 (mandiri abis itu, gak topup lagi buat Sniper) -- TAPI $100/bln yang
// TADINYA buat Sniper, begitu Sniper udah mandiri, DIALIHIN ke SPOT (beli BTC fisik, DCA polos,
// gak pernah dijual -- matching temuan "DCA polos menang telak krn gak pernah keluar pasar").
// Simulasi 2 siklus halving TERAKHIR (2020 & 2024).

const { sma } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');
const { detectFlag, detectWedge } = require('./chartPatterns');
const { detectBullishFVG } = require('./backtestFVG');

const HALVINGS_FOR_BEAR = ['2016-07-09', '2020-05-11', '2024-04-19', '2028-04-13'];
const bearWindows = [];
for (let hi = 0; hi < HALVINGS_FOR_BEAR.length - 1; hi++) {
  const h = new Date(HALVINGS_FOR_BEAR[hi]).getTime();
  const hNext = new Date(HALVINGS_FOR_BEAR[hi + 1]).getTime();
  bearWindows.push({ start: h + 549 * 86400000, end: hNext - 542 * 86400000 });
}
function isBearWindow(ms) { return bearWindows.some((w) => ms >= w.start && ms <= w.end); }

function runSniperPlusSpot(assets, opts = {}) {
  const {
    poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    slBufferPct = 0.5, partialRR = 2, trailSmaLen = 10,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    maxMarginPct = 20, maxNyawaPct = null, trendSmaLen = 200,
  } = opts;

  const assetNames = Object.keys(assets);
  const byDay = {};
  const allDates = new Set();
  for (const name of assetNames) {
    byDay[name] = {};
    for (let i = 0; i < assets[name].length; i++) {
      const dayKey = Math.floor(assets[name][i].closeTime / 86400000);
      byDay[name][dayKey] = i;
      allDates.add(dayKey);
    }
  }
  const sortedDays = [...allDates].sort((a, b) => a - b);
  const warmupCutoff = sortedDays[60] || sortedDays[0];

  const trades = [];
  let openPositions = [];
  let activeFvgsByAsset = {}; for (const n of assetNames) activeFvgsByAsset[n] = [];
  let capital = startCapital;
  let sniperCapped = false; // begitu true, topup Sniper STOP, dialihin spot
  let spotBtc = 0, spotInvested = 0;
  let lastTopUpMonthKey = null;
  const capitalSeries = [{ time: sortedDays[0] * 86400000, capital }];

  function availableCapital() { return Math.max(0, capital - openPositions.reduce((s, p) => s + p.margin, 0)); }
  function closePosition(pos, reasonFull, exitTime, pnlUsd, capitalDelta = pnlUsd) {
    capital = Math.max(0, capital + capitalDelta);
    trades.push({ ...pos, exitReason: reasonFull, pnlUsd, exitTime });
    capitalSeries.push({ time: exitTime, capital });
  }

  for (const dayKey of sortedDays) {
    if (dayKey < warmupCutoff) continue;
    const dateMs = dayKey * 86400000;
    const dateObj = new Date(dateMs);
    const curMonthKey = dateObj.getUTCFullYear() * 12 + dateObj.getUTCMonth();
    if (dateObj.getUTCDate() >= topUpDayOfMonth && curMonthKey !== lastTopUpMonthKey) {
      lastTopUpMonthKey = curMonthKey;
      if (!sniperCapped && capital < topUpStopAt) {
        capital += topUpAmount; capitalSeries.push({ time: dateMs, capital });
      } else {
        sniperCapped = true; // begitu SEKALI capped, SETERUSNYA topup lari ke spot (gak balik lagi ke Sniper walau capital turun krn rugi)
        const btcIdx = byDay.btc ? byDay.btc[dayKey] : undefined;
        if (btcIdx !== undefined) {
          const price = assets.btc[btcIdx].close;
          spotBtc += topUpAmount / price;
          spotInvested += topUpAmount;
        }
      }
    }

    for (const name of assetNames) {
      const idx = byDay[name][dayKey];
      if (idx === undefined) continue;
      const daily = assets[name];
      const today = daily[idx];
      const fvgNew = detectBullishFVG(daily, idx);
      if (fvgNew) activeFvgsByAsset[name].push(fvgNew);
      activeFvgsByAsset[name] = activeFvgsByAsset[name].filter((z) => idx <= z.createdIdx || today.low > z.gapBottom);
      const closesSoFar = daily.slice(0, idx + 1).map((c) => c.close);
      const trailSma = sma(closesSoFar, trailSmaLen);

      const stillOpen = [];
      for (const pos of openPositions) {
        if (pos.asset !== name) { stillOpen.push(pos); continue; }
        if (!pos.partialDone) {
          const hitSl = today.low <= pos.sl;
          const hitPartial = today.high >= pos.partialTp;
          if (hitSl) { closePosition(pos, 'SL', today.closeTime, -pos.lossAtSl); continue; }
          else if (hitPartial) {
            const rewardPct = Math.abs(pos.partialTp - pos.entryPrice) / pos.entryPrice * 100;
            const profitHalf = pos.nilaiPosisi * 0.5 * (rewardPct / 100);
            capital += profitHalf; capitalSeries.push({ time: today.closeTime, capital });
            pos.realizedPnl = profitHalf; pos.partialDone = true; pos.sl = pos.entryPrice;
          }
        } else {
          const hitSl = today.low <= pos.sl;
          const trendBroken = trailSma !== null && today.close < trailSma;
          if (hitSl || trendBroken) {
            const movePctSigned = (today.close - pos.entryPrice) / pos.entryPrice * 100;
            const pnlRest = pos.nilaiPosisi * 0.5 * (movePctSigned / 100);
            const totalPnl = pos.realizedPnl + pnlRest;
            closePosition(pos, hitSl ? 'SL_BREAKEVEN' : 'TRAIL_EXIT', today.closeTime, totalPnl, pnlRest);
            continue;
          }
        }
        stillOpen.push(pos);
      }
      openPositions = stillOpen;
    }

    for (const name of assetNames) {
      const idx = byDay[name][dayKey];
      if (idx === undefined) continue;
      const avail = availableCapital();
      if (avail <= 1) continue;
      if (name === 'btc' && isBearWindow(dateMs)) continue;

      const daily = assets[name];
      const today = daily[idx];
      const modesInUse = new Set(openPositions.filter((p) => p.asset === name).map((p) => p.patternType.startsWith('fvg') ? 'fvg' : 'sniper'));
      const closesSoFar = daily.slice(0, idx + 1).map((c) => c.close);
      const trendSmaFilter = sma(closesSoFar, trendSmaLen);
      const candidates = [];

      if (!modesInUse.has('sniper')) {
        const lastPrice = today.close;
        let direction = null, sl = null, patternType = null;
        const flag = detectFlag(daily, idx, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
        if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) { direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull'; }
        if (!direction) {
          const wedge = detectWedge(daily, idx, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
          if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) { direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling'; }
        }
        if (direction) candidates.push({ entryPrice: lastPrice, sl, patternType });
      }
      if (!modesInUse.has('fvg') && (trendSmaFilter === null || today.close >= trendSmaFilter)) {
        const zone = activeFvgsByAsset[name].find((z) => {
          if (idx <= z.createdIdx) return false;
          if (!z._touched && today.low <= z.gapTop) z._touched = true;
          return z._touched && today.close > z.gapTop;
        });
        if (zone) { candidates.push({ entryPrice: today.close, sl: zone.gapBottom, patternType: 'fvg_bounce' }); activeFvgsByAsset[name] = activeFvgsByAsset[name].filter((z) => z !== zone); }
      }

      for (const cand of candidates) {
        const availNow = availableCapital();
        if (availNow <= 1) break;
        const riskDistance = cand.entryPrice - cand.sl;
        if (riskDistance <= 0) continue;
        const nyawaPct = riskDistance / cand.entryPrice * 100;
        if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue;
        const { nilaiPosisi, margin } = hitungExposure({ modal: availNow, entry: cand.entryPrice, stopLoss: cand.sl });
        if (margin > availNow) continue;
        const marginPct = margin / availNow * 100;
        if (marginPct > maxMarginPct) continue;
        const lossAtSl = nilaiPosisi * (nyawaPct / 100);
        const partialTp = cand.entryPrice + riskDistance * partialRR;
        openPositions.push({
          asset: name, direction: 'buy', entryPrice: cand.entryPrice, sl: cand.sl, originalSl: cand.sl, partialTp, entryTime: today.closeTime,
          nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType: cand.patternType,
        });
      }
    }
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  const lastBtcIdx = assets.btc.length - 1;
  const finalBtcPrice = assets.btc[lastBtcIdx].close;
  const spotValue = spotBtc * finalBtcPrice;
  return { trades, sniperFinal: capital, maxDrawdownPct, spotBtc, spotInvested, spotValue, finalBtcPrice, totalFinal: capital + spotValue };
}

module.exports = { runSniperPlusSpot };
