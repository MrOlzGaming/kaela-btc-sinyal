// backtest/rsiOversoldBounceScalp.js -- (5 Sep 2026, permintaan Olan: "cari trader compound di
// internet.. pelajari lalu kita backtest bareng2") -- replikasi "RSI Oversold Bounce Scalping"
// yang ditemuin dari riset web (Coinquant.ai, BTC/USDT 15m, 6 bulan Des 2025-Jun 2026): entry RSI
// turun <30 lalu naik balik >30 (konfirmasi mantul), exit RSI >60, 100% modal, TANPA stop-loss.
// Laporan aslinya JUJUR: win-rate 66,3% (92 trade) TAPI total return -16,88%, drawdown -30,6% --
// "win rate paradox" (menang sering kecil-kecil, kalah jarang tapi BESAR krn gak ada SL).
//
// DI SINI: replikasi metodologi ASLI (baseline, TANPA SL) dulu buat verifikasi independen (bukan
// percaya laporan orang lain doang), MULTI-TAHUN + breakdown per tahun + split era (disiplin
// proyek ini) -- 6 bulan doang gak cukup buat nyimpulin apa-apa. Abis itu 1 VARIAN TAMBAHAN pakai
// stop-loss wajar, buat liat apa dugaan "SL bakal benerin ini" itu bener atau enggak.

const { fetchKlines } = require('./fetchKlines');

const RSI_PERIOD = 14;
const RSI_OVERSOLD = 30;
const RSI_EXIT = 60;
const SL_PCT_VARIANTS = [null, 2, 3]; // null = baseline ASLI (tanpa SL), 2%/3% = varian tambahan

// 5 Sep 2026, permintaan Olan ("bebasin kamu cari strategi compound terbaik") -- lanjutan riset:
// SL 2%/3% (di atas) TERBUKTI memperburuk, bukan berarti "SL gak berguna", tapi SL SESEMPIT itu
// motong pemulihan mean-reversion yang WAJAR (harga oversold sering butuh ruang lebih lebar
// sebelum beneran mantul). Coba SL lebih LEBAR (biar cuma nahan kerugian KATASTROFIK, bukan
// noise normal) + FILTER TREN (SMA 200 -- cuma ambil sinyal long kalau harga MASIH di atas tren
// jangka panjang, skip kalau lagi downtrend kuat -- "jangan nangkep pisau jatuh").
const SL_WIDE_VARIANTS = [8, 12];
const TREND_SMA_PERIOD = 200;

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

function computeRSI(closes, period) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length <= period) return rsi;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff; else lossSum -= diff;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period; // Wilder's smoothing, standar RSI
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// Simulasi 1 varian (slPct null = baseline asli TANPA SL, sama persis metodologi yang di-backtest
// Coinquant.ai) -- 100% modal/trade (SAMA kayak sumber aslinya, biar apple-to-apple SEBELUM
// nyoba variasi sendiri).
// `trendSma` opsional (null = gak difilter, SAMA kayak baseline asli) -- kalau diisi, entry CUMA
// diambil kalau candle[i].close MASIH di atas SMA (harga masih dalam tren naik jangka panjang,
// "oversold di uptrend" beda karakter dari "oversold krn lagi ambruk").
function simulate(candles, rsi, slPct, trendSma) {
  const trades = [];
  let wasOversold = false; // flag: RSI PERNAH di bawah 30 sejak posisi terakhir ditutup
  let inPosition = false, entryPrice = null, entryIdx = null;

  for (let i = RSI_PERIOD + 1; i < candles.length; i++) {
    const r = rsi[i];
    if (r == null) continue;
    const prevR = rsi[i - 1];

    if (!inPosition) {
      if (r < RSI_OVERSOLD) wasOversold = true;
      // Entry: RSI baru aja NAIK LEWATIN 30 (dari bawah), DAN sebelumnya udah pernah oversold,
      // DAN (kalau filter tren aktif) harga masih di atas SMA jangka panjang.
      const trendOk = !trendSma || (trendSma[i] != null && candles[i].close > trendSma[i]);
      if (wasOversold && prevR < RSI_OVERSOLD && r >= RSI_OVERSOLD && trendOk) {
        inPosition = true;
        entryPrice = candles[i].close;
        entryIdx = i;
        wasOversold = false;
      }
    } else {
      const slPrice = slPct != null ? entryPrice * (1 - slPct / 100) : null;
      const hitSl = slPrice != null && candles[i].low <= slPrice;
      const hitExit = r >= RSI_EXIT;
      if (hitSl || hitExit) {
        const exitPrice = hitSl ? slPrice : candles[i].close;
        const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        trades.push({ entryTime: candles[entryIdx].openTime, exitTime: candles[i].openTime, entryPrice, exitPrice, pnlPct, exitReason: hitSl ? 'SL' : 'RSI60' });
        inPosition = false; entryPrice = null; entryIdx = null;
      }
    }
  }
  return trades;
}

function summarizeTrades(trades, label) {
  if (!trades.length) { console.log(`  ${label}: n=0`); return; }
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const winRate = (wins.length / trades.length) * 100;
  const sumWin = wins.reduce((a, t) => a + t.pnlPct, 0);
  const sumLoss = Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0));
  const pf = sumLoss > 0 ? (sumWin / sumLoss).toFixed(2) : (sumWin > 0 ? 'inf' : '-');
  // Return KOMPON (compound, 100% modal/trade beruntun -- SAMA metodologi sumber aslinya)
  let equity = 100;
  let peak = 100, maxDD = 0;
  for (const t of trades) {
    equity *= (1 + t.pnlPct / 100);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
  }
  const totalReturnPct = equity - 100;
  console.log(`  ${label}: n=${trades.length} winRate=${winRate.toFixed(1)}% PF=${pf} totalReturn(compound)=${totalReturnPct.toFixed(1)}% maxDD=${maxDD.toFixed(1)}%`);
}

async function main() {
  console.log('Ambil candle 15m BTCUSDT 2019-2026 (bisa agak lama)...');
  const startMs = Date.UTC(2019, 0, 1);
  const endMs = Date.now();
  const candles = await fetchKlines('BTCUSDT', '15m', startMs, endMs);
  console.log(`Total candle: ${candles.length} | ${new Date(candles[0].openTime).toISOString()} -> ${new Date(candles[candles.length - 1].openTime).toISOString()}`);

  const closes = candles.map((c) => c.close);
  const rsi = computeRSI(closes, RSI_PERIOD);
  const trendSma = computeSMA(closes, TREND_SMA_PERIOD);

  function runVariant(label, slPct, useTrend) {
    console.log(`\n=== ${label} ===`);
    const trades = simulate(candles, rsi, slPct, useTrend ? trendSma : null);
    summarizeTrades(trades, 'FULL PERIOD');

    const byYear = {};
    for (const t of trades) {
      const y = new Date(t.entryTime).getUTCFullYear();
      (byYear[y] = byYear[y] || []).push(t);
    }
    for (const y of Object.keys(byYear).sort()) summarizeTrades(byYear[y], `  ${y}`);

    const era1 = trades.filter((t) => t.entryTime < Date.UTC(2023, 0, 1));
    const era2 = trades.filter((t) => t.entryTime >= Date.UTC(2023, 0, 1));
    summarizeTrades(era1, '  Era1 <2023');
    summarizeTrades(era2, '  Era2 >=2023');
  }

  // Grup 1: replikasi baseline asli + varian SL sempit (SUDAH diverifikasi sebelumnya, dijalanin
  // ulang di sini biar 1 laporan utuh, gak perlu buka hasil lama).
  for (const slPct of SL_PCT_VARIANTS) {
    const label = slPct == null ? 'BASELINE (tanpa SL, replikasi asli)' : `Varian SL ${slPct}%`;
    runVariant(label, slPct, false);
  }

  // Grup 2 (BARU, 5 Sep -- "cari strategi compound terbaik"): SL LEBAR (8%/12%), TANPA filter
  // tren dulu -- biar keliatan efek SL lebar doang, terpisah dari efek filter tren.
  for (const slPct of SL_WIDE_VARIANTS) {
    runVariant(`Varian SL LEBAR ${slPct}% (tanpa filter tren)`, slPct, false);
  }

  // Grup 3 (BARU): SL LEBAR + filter tren SMA200 digabung.
  for (const slPct of SL_WIDE_VARIANTS) {
    runVariant(`Varian SL LEBAR ${slPct}% + filter tren SMA${TREND_SMA_PERIOD}`, slPct, true);
  }

  // Grup 4 (BARU): filter tren SAJA, TANPA SL sama sekali -- biar keliatan kontribusi filter tren
  // murni terpisah dari efek SL.
  runVariant(`BASELINE (tanpa SL) + filter tren SMA${TREND_SMA_PERIOD}`, null, true);
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR rsiOversoldBounceScalp.js:', e.message); process.exit(1); });
}

module.exports = { computeRSI, simulate };
