const { fetchKlines } = require('./fetchKlines');
const { getExposure, getEffectiveExposure, getDynamicRiskPerTrade } = require('./moneyManagement');

const STARTING_BALANCE = 100;
const TOPUP_AMOUNT = 100;
const RESCUE_BELOW = 100;
const STOP_PCT = 0.45; // lebih lebar dari drawdown terdalam historis (34.3%)
const LEVERAGE = Math.floor(1 / STOP_PCT); // = 2x

// Siklus: [beli, jual-target]. Antara siklus = tunai/nunggu.
const CYCLES = [
  { buy: '2017-08-17', sell: '2021-11-08' },
  { buy: '2024-01-01', sell: '2025-10-19' },
];

async function main() {
  const now = Date.now();
  const listing = new Date('2017-08-17T00:00:00Z').getTime();
  const daily = await fetchKlines('BTCUSDT', '1d', listing, now);

  function idxNear(dateStr) {
    const t = new Date(dateStr).getTime();
    return daily.findIndex((c) => c.closeTime >= t);
  }

  let balance = STARTING_BALANCE;
  let totalDeposited = STARTING_BALANCE;
  let peak = STARTING_BALANCE;
  let maxDD = 0;
  const trades = [];

  // top-up bulanan (rescue <$100) diterapkan ke semua hari DI LUAR window hold (simplifikasi: cuma di awal tiap siklus)
  function applyTopupsBetween(fromIdx, toIdx) {
    let lastMonth = null;
    for (let i = fromIdx; i <= toIdx; i++) {
      const d = new Date(daily[i].closeTime);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      if (d.getUTCDate() === 5 && key !== lastMonth) {
        lastMonth = key;
        if (balance < RESCUE_BELOW) {
          balance += TOPUP_AMOUNT;
          totalDeposited += TOPUP_AMOUNT;
        }
      }
    }
  }

  let cursorIdx = 0;

  for (const cycle of CYCLES) {
    const buyIdx = idxNear(cycle.buy);
    const sellIdx = idxNear(cycle.sell);

    applyTopupsBetween(cursorIdx, buyIdx);

    const entry = daily[buyIdx].close;
    const stopPrice = entry * (1 - STOP_PCT);

    const baseExposure = getExposure(balance);
    const exposure = getEffectiveExposure(baseExposure, LEVERAGE);
    const riskPerTradePct = getDynamicRiskPerTrade(balance);
    const capitalAtRisk = balance * riskPerTradePct;

    // cari apakah stop kesentuh sebelum tanggal jual target
    let exitIdx = sellIdx;
    let exitPrice = daily[sellIdx].close;
    let stopped = false;
    for (let i = buyIdx; i <= sellIdx; i++) {
      if (daily[i].low <= stopPrice) {
        exitIdx = i;
        exitPrice = stopPrice;
        stopped = true;
        break;
      }
    }

    const priceMovePct = (exitPrice - entry) / entry;
    const growthPct = exposure * priceMovePct;
    const pnlDollar = capitalAtRisk * growthPct;
    const balanceBefore = balance;
    balance = balance + pnlDollar;
    peak = Math.max(peak, balance);
    maxDD = Math.max(maxDD, (peak - balance) / peak);

    trades.push({
      buyDate: cycle.buy,
      sellDate: daily[exitIdx].date || new Date(daily[exitIdx].closeTime).toISOString().slice(0, 10),
      entry, exit: exitPrice, stopped,
      exposure, leverage: LEVERAGE, capitalAtRisk,
      balanceBefore, balanceAfter: balance,
    });

    cursorIdx = exitIdx;
  }

  applyTopupsBetween(cursorIdx, daily.length - 1);

  console.log('=== STRATEGI SIKLUS HALVING + LEVERAGE 2x ===');
  console.log(`Stop-loss: -${(STOP_PCT * 100).toFixed(0)}% dari entry (buffer di atas drawdown terdalam historis 34.3%)`);
  console.log();
  for (const t of trades) {
    console.log(`${t.buyDate} -> ${t.sellDate} | entry $${t.entry.toFixed(0)} -> exit $${t.exit.toFixed(0)} ${t.stopped ? '(KENA STOP)' : '(target tercapai)'}`);
    console.log(`  exposure=${t.exposure}x leverage=${t.leverage}x capitalAtRisk=$${t.capitalAtRisk.toFixed(0)} | saldo $${t.balanceBefore.toFixed(0)} -> $${t.balanceAfter.toFixed(0)}`);
  }
  console.log();
  const totalReturn = ((balance - totalDeposited) / totalDeposited) * 100;
  const years = 8.2;
  const cagr = (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;
  console.log(`Total disetor: $${totalDeposited.toFixed(0)} | Saldo akhir: $${balance.toFixed(0)}`);
  console.log(`Return: ${totalReturn.toFixed(1)}% | CAGR: ${cagr.toFixed(1)}%/th | Max Drawdown: ${(maxDD * 100).toFixed(1)}%`);
}

main().catch((e) => { console.error(e); process.exit(1); });
