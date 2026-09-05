// backtest/rsiOversoldBounceScalp5m.js -- (5 Sep 2026, lanjutan riset "cari strategi compound
// terbaik, modal super kecil, trade sering per hari") -- rsiOversoldBounceScalp.js (TF 15m)
// ketemu edge robust (filter tren SMA200) TAPI sinyalnya jarang (~1x/12 hari), gak cocok buat
// compounding harian. Di sini: metodologi SAMA PERSIS (RSI(14) oversold-bounce + filter tren),
// pindah ke TF 5m biar sinyal lebih sering -- SMA periode di-SKALA biar durasi filter tren
// (dalam JAM/HARI, bukan jumlah candle) tetap sepadan sama SMA50-400 di TF 15m.
const { fetchKlines } = require('./fetchKlines');
const { computeRSI, simulate } = require('./rsiOversoldBounceScalp.js');

const RSI_PERIOD = 14;
const ROUND_TRIP_COST_PCT = 0.10; // taker+taker kasar, buat cek net-of-cost krn frekuensi naik

// SMA15m -> candle 5m setara (durasi jam sama): 50->150, 100->300, 150->450, 200->600, 300->900,
// 400->1200. Ditambah beberapa titik lain biar sensitivity-nya lebih rapat di sekitar area bagus.
const SMA_CANDIDATES_5M = [150, 300, 450, 600, 900, 1200];

function computeSMA(closes, period) {
  const sma = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) sma[i] = sum / period;
  }
  return sma;
}

function summarizeTrades(trades, label, { netOfCost } = {}) {
  if (!trades.length) { console.log(`  ${label}: n=0`); return; }
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const winRate = (wins.length / trades.length) * 100;
  const sumWin = wins.reduce((a, t) => a + t.pnlPct, 0);
  const sumLoss = Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0));
  const pf = sumLoss > 0 ? (sumWin / sumLoss).toFixed(2) : (sumWin > 0 ? 'inf' : '-');
  let equity = 100, peak = 100, maxDD = 0;
  let equityNet = 100, peakNet = 100, maxDDNet = 0;
  for (const t of trades) {
    equity *= (1 + t.pnlPct / 100);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
    const netPct = t.pnlPct - ROUND_TRIP_COST_PCT;
    equityNet *= (1 + netPct / 100);
    peakNet = Math.max(peakNet, equityNet);
    maxDDNet = Math.max(maxDDNet, (peakNet - equityNet) / peakNet * 100);
  }
  const totalReturnPct = equity - 100;
  const totalReturnNetPct = equityNet - 100;
  let line = `  ${label}: n=${trades.length} winRate=${winRate.toFixed(1)}% PF=${pf} return=${totalReturnPct.toFixed(1)}% maxDD=${maxDD.toFixed(1)}%`;
  if (netOfCost) line += ` | NET(cost ${ROUND_TRIP_COST_PCT}%/trade): return=${totalReturnNetPct.toFixed(1)}% maxDD=${maxDDNet.toFixed(1)}%`;
  console.log(line);
}

async function main() {
  console.log('Ambil candle 5m BTCUSDT 2019-2026 (LEBIH BANYAK data drpd 15m, bisa beberapa menit)...');
  const startMs = Date.UTC(2019, 0, 1);
  const endMs = Date.now();
  const candles = await fetchKlines('BTCUSDT', '5m', startMs, endMs);
  console.log(`Total candle: ${candles.length} | ${new Date(candles[0].openTime).toISOString()} -> ${new Date(candles[candles.length - 1].openTime).toISOString()}`);

  const closes = candles.map((c) => c.close);
  const rsi = computeRSI(closes, RSI_PERIOD);

  function runVariant(label, smaPeriod, opts) {
    console.log(`\n=== ${label} ===`);
    const trendSma = smaPeriod ? computeSMA(closes, smaPeriod) : null;
    const trades = simulate(candles, rsi, null, trendSma);
    summarizeTrades(trades, 'FULL PERIOD', opts);
    const perYearAvg = trades.length / 7.7;
    console.log(`  (rata-rata ~${perYearAvg.toFixed(0)} trade/tahun, ~${(perYearAvg / 365).toFixed(2)} trade/hari)`);

    const byYear = {};
    for (const t of trades) {
      const y = new Date(t.entryTime).getUTCFullYear();
      (byYear[y] = byYear[y] || []).push(t);
    }
    for (const y of Object.keys(byYear).sort()) summarizeTrades(byYear[y], `  ${y}`, opts);

    const era1 = trades.filter((t) => t.entryTime < Date.UTC(2023, 0, 1));
    const era2 = trades.filter((t) => t.entryTime >= Date.UTC(2023, 0, 1));
    summarizeTrades(era1, '  Era1 <2023', opts);
    summarizeTrades(era2, '  Era2 >=2023', opts);
  }

  runVariant('BASELINE (tanpa filter tren) -- TF 5m', null, { netOfCost: true });
  for (const p of SMA_CANDIDATES_5M) {
    runVariant(`+ filter tren SMA${p} (5m)`, p, { netOfCost: true });
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR rsiOversoldBounceScalp5m.js:', e.message); process.exit(1); });
}
