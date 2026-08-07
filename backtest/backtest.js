const { getExposure, computeLeverage, getEffectiveExposure, getDynamicRiskPerTrade } = require('./moneyManagement');
const { getHalvingPhaseDirection } = require('./halvingCycle');

const STARTING_BALANCE = 100;
const TOPUP_AMOUNT = 100;
const TOPUP_DAY = 5; // tanggal 5 tiap bulan
const RESCUE_BELOW = 100; // top-up cuma jaring pengaman kalau saldo jatuh di bawah modal awal
const WITHDRAW_AT = 100000; // begitu saldo >= ini, tarik 90% (aman utk hidup), 10% lanjut compound

// dailyCandles: raw candle array (for high/low exit checks)
// signalRows: aligned output of buildSignalSeries
// opts.rr: Risk:Reward ratio buat TP (default 3)
// opts.riskPerTradePct: fraksi SALDO yang boleh jadi modal per-trade (default 1.0 = semua saldo, perilaku lama)
// opts.dynamicRisk: true -> abaikan riskPerTradePct tetap, pakai getDynamicRiskPerTrade(balance) tiap entry
// opts.allowConcurrent: true -> boleh buka posisi baru meski masih ada yang OPEN, selama ada modal nganggur
function runBacktest(dailyCandles, signalRows, opts = {}) {
  const RR = opts.rr ?? 3;
  const staticRiskPerTradePct = opts.riskPerTradePct ?? 1.0;
  const candleByTime = new Map(dailyCandles.map((c) => [c.closeTime, c]));

  let balance = STARTING_BALANCE;
  let peak = STARTING_BALANCE;
  let maxDrawdownPct = 0;
  let totalDeposited = STARTING_BALANCE;
  let totalWithdrawn = 0;
  let lastTopUpMonthKey = null;

  let positions = []; // bisa lebih dari 1 kalau opts.allowConcurrent
  const trades = [];
  const withdrawals = [];
  const dailyLog = [];

  function checkWithdrawal(date) {
    while (balance >= WITHDRAW_AT) {
      const cashOut = balance * 0.9;
      totalWithdrawn += cashOut;
      balance = balance * 0.1;
      withdrawals.push({ date, cashOut, balanceAfter: balance });
      dailyLog.push({ date, event: `WITHDRAW 90% ($${cashOut.toFixed(0)}), sisa compound`, balance });
    }
  }

  for (let i = 0; i < signalRows.length; i++) {
    const row = signalRows[i];
    const candle = candleByTime.get(row.closeTime);

    // Top-up = jaring pengaman, HANYA kalau saldo jatuh di bawah modal awal ($100)
    const d = new Date(row.closeTime);
    const monthKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (d.getUTCDate() === TOPUP_DAY && monthKey !== lastTopUpMonthKey) {
      lastTopUpMonthKey = monthKey;
      if (balance < RESCUE_BELOW) {
        balance += TOPUP_AMOUNT;
        totalDeposited += TOPUP_AMOUNT;
        peak = Math.max(peak, balance);
        dailyLog.push({ date: row.date, event: `TOPUP +${TOPUP_AMOUNT} (saldo < $${RESCUE_BELOW})`, balance });
      }
    }

    // Cek exit SEMUA posisi yang lagi OPEN (bukan cuma 1)
    const stillOpen = [];
    for (const pos of positions) {
      let closed = null;
      if (pos.direction === 'BUY') {
        if (candle.low <= pos.liqPrice) closed = { reason: 'LIQ', exitPrice: pos.liqPrice };
        else if (candle.high >= pos.tpPrice) closed = { reason: 'TP', exitPrice: pos.tpPrice };
      } else {
        if (candle.high >= pos.liqPrice) closed = { reason: 'LIQ', exitPrice: pos.liqPrice };
        else if (candle.low <= pos.tpPrice) closed = { reason: 'TP', exitPrice: pos.tpPrice };
      }

      if (closed) {
        const priceMovePct = closed.reason === 'TP' ? pos.riskDistance * RR : -pos.riskDistance;
        const growthPct = pos.exposure * priceMovePct;
        const pnlDollar = pos.capitalAtRisk * growthPct;
        const balanceBefore = balance;
        balance = balance + pnlDollar;
        peak = Math.max(peak, balance);
        maxDrawdownPct = Math.max(maxDrawdownPct, (peak - balance) / peak);

        trades.push({
          entryDate: pos.entryDate,
          exitDate: row.date,
          direction: pos.direction,
          entry: pos.entry,
          exit: closed.exitPrice,
          result: closed.reason,
          riskDistance: pos.riskDistance,
          leverage: pos.leverage,
          exposure: pos.exposure,
          balanceBefore,
          balanceAfter: balance,
        });

        dailyLog.push({ date: row.date, event: `CLOSE ${closed.reason}`, balance });
        checkWithdrawal(row.date);
      } else {
        stillOpen.push(pos);
      }
    }
    positions = stillOpen;

    if (positions.length > 0 && !opts.allowConcurrent) {
      dailyLog.push({ date: row.date, event: 'HOLD (nunggu slot, no concurrent)', balance });
      continue;
    }

    let effectiveSignal = (opts.longOnly && row.signal === 'SELL') ? 'WAIT' : row.signal;

    // Filter siklus halving: tahun ke-0/3 pasca halving cuma boleh BUY, tahun ke-1/2 cuma boleh SELL
    // (atau kalau opts.halvingNoShort: tahun ke-1/2 cuma diam, gak ikut short sama sekali)
    if (opts.halvingCycleFilter && effectiveSignal !== 'WAIT') {
      const allowedDirection = getHalvingPhaseDirection(row.closeTime);
      if (allowedDirection !== null && effectiveSignal !== allowedDirection) {
        effectiveSignal = 'WAIT';
      }
    }
    if (opts.halvingNoShort && effectiveSignal !== 'WAIT') {
      const allowedDirection = getHalvingPhaseDirection(row.closeTime);
      if (allowedDirection === 'SELL') effectiveSignal = 'WAIT';
      if (allowedDirection === 'BUY' && effectiveSignal === 'SELL') effectiveSignal = 'WAIT';
    }

    if (effectiveSignal === 'WAIT') {
      dailyLog.push({ date: row.date, event: 'WAIT', reason: row.reason, balance });
      continue;
    }

    const entry = row.entryPrice;
    // opts.fixedSLPct: kalau diisi (mis. 0.10), SL PAKSA jarak tetap dari entry, bukan swing high/low struktural.
    // SL lebar bikin leverage kepaksa kecil -> exposure ke-clamp -> rugi ~100% modal per-trade. SL ketat menghindari itu.
    let riskArea;
    if (opts.fixedSLPct) {
      riskArea = effectiveSignal === 'BUY' ? entry * (1 - opts.fixedSLPct) : entry * (1 + opts.fixedSLPct);
    } else {
      riskArea = effectiveSignal === 'BUY' ? row.dailyStructState.lastSwingLow : row.dailyStructState.lastSwingHigh;
      // opts.maxRiskDistancePct: structural SL tetap dipakai, tapi kalau jaraknya kelewat lebar, dipotong ke batas ini
      if (opts.maxRiskDistancePct && riskArea !== null) {
        const dist = Math.abs(entry - riskArea) / entry;
        if (dist > opts.maxRiskDistancePct) {
          riskArea = effectiveSignal === 'BUY' ? entry * (1 - opts.maxRiskDistancePct) : entry * (1 + opts.maxRiskDistancePct);
        }
      }
    }

    const invalid = riskArea === null
      || (effectiveSignal === 'BUY' && riskArea >= entry)
      || (effectiveSignal === 'SELL' && riskArea <= entry);

    if (invalid) {
      dailyLog.push({ date: row.date, event: 'SKIP (invalid risk area)', balance });
      continue;
    }

    const riskDistance = Math.abs(entry - riskArea) / entry;
    const leverage = computeLeverage(riskDistance);
    const tpDistance = riskDistance * RR;
    const tpPrice = effectiveSignal === 'BUY' ? entry * (1 + tpDistance) : entry * (1 - tpDistance);
    const baseExposure = getExposure(balance);
    const exposure = getEffectiveExposure(baseExposure, leverage);
    const riskPerTradePct = opts.dynamicRisk ? getDynamicRiskPerTrade(balance, opts.dynamicRiskOpts) : staticRiskPerTradePct;

    // Modal yang udah "dipegang" posisi lain (margin, bukan capitalAtRisk) gak boleh dipakai dobel.
    const committedMargin = positions.reduce((sum, p) => sum + p.margin, 0);
    const availableCapital = Math.max(0, balance - committedMargin);
    const desiredCapitalAtRisk = balance * riskPerTradePct;
    const capitalAtRisk = Math.min(desiredCapitalAtRisk, availableCapital);

    if (capitalAtRisk <= 0) {
      dailyLog.push({ date: row.date, event: 'SKIP (modal nganggur habis, semua kekunci posisi lain)', balance });
      continue;
    }

    const margin = (capitalAtRisk * exposure) / leverage;

    positions.push({
      direction: effectiveSignal,
      entry,
      liqPrice: riskArea,
      tpPrice,
      riskDistance,
      leverage,
      exposure,
      capitalAtRisk,
      margin,
      entryDate: row.date,
    });

    dailyLog.push({ date: row.date, event: `OPEN ${effectiveSignal} (posisi ke-${positions.length})`, entry, riskArea, leverage, tpPrice, capitalAtRisk, balance });
  }

  const wins = trades.filter((t) => t.result === 'TP').length;
  const losses = trades.filter((t) => t.result === 'LIQ').length;
  const netWorth = balance + totalWithdrawn;

  return {
    startingBalance: STARTING_BALANCE,
    endingBalance: balance,
    totalDeposited,
    totalWithdrawn,
    netWorth,
    netTradingProfit: netWorth - totalDeposited,
    returnOnDepositedPct: ((netWorth - totalDeposited) / totalDeposited) * 100,
    totalTrades: trades.length,
    wins,
    losses,
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    maxDrawdownPct: maxDrawdownPct * 100,
    reached100k: withdrawals.length > 0,
    withdrawals,
    trades,
    dailyLog,
  };
}

module.exports = { runBacktest };
