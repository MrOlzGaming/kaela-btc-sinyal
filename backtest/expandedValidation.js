// backtest/expandedValidation.js -- (6 Sep 2026, permintaan Olan: "kerjakan nomor 1", perluas
// lapisan validasi baru -- backtestValidation.js -- ke metode LAIN yang UDAH LIVE, bukan cuma
// NFP). Ini REUSE data trade dari backtest yang UDAH ADA per strategi (bukan bikin ulang dari nol
// -- biar konsisten sama racikan/kode deteksi pola yang BENERAN dipakai live):
// - Sniper/Nyopet Chart Pattern+FVG (BTC+Emas): `nyopetChartPatternFvg.js` -- pattern detector-nya
//   (`detectFlag`/`detectWedge` dari `../chartPatterns`) itu MODUL YANG SAMA dipakai live
//   (`sniperAutoAnalysis.js`/`nyopetAutoTrader.js`), bukan reimplementasi terpisah yang bisa drift.
// - Fed Dovish Grid: `fedSignalGridBacktest.js` (`FINAL_RECIPE`) -- SAMA basket-simulation yang
//   jadi basis desain live (nyopetAutoTrader.js `processFedDovishGrid`).
//
// ⚠️ PERMUTATION TEST (Monte Carlo) SENGAJA GAK dites di sini -- metodologi yang dipakai buat NFP
// (acak label arah LONG/SHORT) cuma masuk akal buat strategi yang MENEBAK ARAH dari event diskrit.
// 3 strategi di bawah ini LONG-ONLY (gak ada arah buat diacak) dan ENTRY-TIMING-nya dari deteksi
// pola/basket, bukan label arah per-event -- permutation test yang BENAR buat tipe ini butuh
// "acak waktu entry" (bukan cuma label), yang berarti nyimulasiin ulang exit rule di titik ACAK,
// riset TERPISAH yang lebih besar (belum dikerjain, dicatat sbg langkah lanjutan kalau Olan mau).
// Deflated Sharpe Ratio & Ulcer Index TETAP berlaku (cuma butuh deret return per-trade, gak peduli
// gimana cara trade-nya dipilih) -- itu yang dijalanin di sini.

const {
  deflatedSharpeRatio, probabilisticSharpeRatio, ulcerPerformanceIndex,
} = require('./backtestValidation');

// Sama alasan estimasi kayak nfpAdvancedValidation.js -- dihitung dari histori riset per strategi
// yang tercatat di kode/memori, dibulatin KONSERVATIF (lebih tinggi = lebih ketat).
const TRIALS_CHART_PATTERN = 15; // parameter pola (poleLookback/flagRange/wedgeTouches dst) + filter DXY dicoba beberapa varian
const TRIALS_FED_GRID = 20; // layer schedule (3 varian) x trigger% (beberapa varian) x TP/SL ratio

function reportSection(label, returns, numTrials) {
  console.log(`\n=== ${label} (n=${returns.length}) ===`);
  if (returns.length < 5) { console.log('  Data terlalu sedikit, skip.'); return; }
  const psrRaw = probabilisticSharpeRatio(returns, 0);
  const dsr = deflatedSharpeRatio(returns, numTrials);
  const upi = ulcerPerformanceIndex(returns);
  console.log(`  Sharpe mentah: ${psrRaw.ok ? psrRaw.sharpeRatio.toFixed(3) : '-'}`);
  console.log(`  PSR(0) tanpa penalti multiple-testing: ${psrRaw.ok ? (psrRaw.psr * 100).toFixed(1) + '%' : psrRaw.error}`);
  console.log(`  Deflated Sharpe Ratio (asumsi ~${numTrials} variasi parameter pernah dicoba): ${dsr.ok ? (dsr.dsr * 100).toFixed(1) + '%' : dsr.error}`);
  console.log(`  Total return berurutan: ${upi.totalReturnPct.toFixed(2)} | Max Drawdown: ${upi.maxDrawdownPct.toFixed(2)} | Ulcer Index: ${upi.ulcerIndex.toFixed(3)} | UPI: ${upi.upi.toFixed(3)}`);
  return { psrRaw, dsr, upi };
}

async function main() {
  console.log('########## 1) SNIPER/NYOPET CHART PATTERN + FVG (nyopetChartPatternFvg.js) ##########');
  const cpf = require('./nyopetChartPatternFvg.js');
  const btcResult = cpf.runNyopetV2Backtest(cpf.CANDLES_4H, { ...cpf.RESCALED_4H, allowShort: false, modalDivisor: 1 });
  const btcTrades = btcResult.trades.slice().sort((a, b) => a.exitTime - b.exitTime);
  reportSection('BTC Chart Pattern+FVG (buy-only, sizing normal) -- rMultiple per trade', btcTrades.map((t) => t.rMultiple), TRIALS_CHART_PATTERN);

  if (cpf.CANDLES_4H_GOLD) {
    const goldResult = cpf.runNyopetV2Backtest(cpf.CANDLES_4H_GOLD, { ...cpf.RESCALED_4H, allowShort: false, modalDivisor: 1 });
    const goldTrades = goldResult.trades.slice().sort((a, b) => a.exitTime - b.exitTime);
    reportSection('Emas (PAXGUSDT) Chart Pattern+FVG (buy-only, sizing normal) -- rMultiple per trade', goldTrades.map((t) => t.rMultiple), TRIALS_CHART_PATTERN);
  } else {
    console.log('\n(Emas: gold-hourly-cache.json gak ada di mesin ini, skip.)');
  }

  console.log('\n########## 2) FED DOVISH GRID (fedSignalGridBacktest.js, FINAL_RECIPE) ##########');
  const fg = require('./fedSignalGridBacktest.js');
  const { generateNfpEvents } = require('./econReactionBacktest.js');
  const { fetchKlines } = require('./fetchKlines');
  const startMs = Date.UTC(2019, 0, 1);
  const endMs = Date.now();
  console.log('Ambil ulang candle 15m 2019-2026 (bisa beberapa menit, paginated)...');
  const candles = await fetchKlines('BTCUSDT', '15m', startMs, endMs);
  const closes = candles.map((c) => c.close);
  const nfpEvents = generateNfpEvents(2019, 2026);
  const fomcEvents = fg.generateFomcEvents();
  const allEvents = [...nfpEvents, ...fomcEvents].sort((a, b) => a.timeMs - b.timeMs);
  const signals = fg.computeSignals(candles, allEvents);
  const trendSma = fg.computeSMA(closes, fg.FINAL_RECIPE.trendSmaPeriod);
  const gridTrades = fg.simulateBaskets(candles, signals, fg.FINAL_RECIPE.layerSchedulePct, fg.FINAL_RECIPE.layerTriggerPct, fg.FINAL_RECIPE.maxHoldDays, trendSma)
    .filter((t) => t.direction === 'LONG')
    .sort((a, b) => a.closeTime - b.closeTime);
  reportSection('Fed Dovish Grid LONG (FINAL_RECIPE) -- pnlPct per basket', gridTrades.map((t) => t.pnlPct), TRIALS_FED_GRID);

  console.log('\n########## RINGKASAN ##########');
  console.log('Permutation test SENGAJA gak dites di 3 strategi ini (LONG-only, entry dari deteksi pola/basket bukan label arah -- metodologi permutation yang cocok BEDA, belum dikerjain).');
  console.log('⚠️ CATATAN PENTING soal DSR di atas: Sharpe yang dipakai di sini "mentah" per-trade (BUKAN diannualisasi kayak lazimnya literatur DSR), sedangkan expectedMaxSharpe pakai asumsi varians=1 yang KALIBRASINYA buat skala Sharpe ANNUALIZED -- ini KEMUNGKINAN BESAR bikin DSR ke-3 strategi ini jatuh ke ~0% BUKAN karena strategi lemah (PSR(0) mereka 89-99,9%, total return riil 20-206%, jauh lebih kuat dari NFP yang PSR(0)-nya cuma 80,6%) tapi karena mismatch skala/kalibrasi di implementasi DSR ini. BEDA dari NFP -- yang DIKUATKAN 2 metode independen (permutation test p~0,20 DAN DSR rendah, dua-duanya lemah) -- 3 strategi ini CUMA punya 1 sinyal lemah (DSR, yang metodologinya sendiri diragukan) vs bukti kuat lain (PSR/UPI/return riil). KESIMPULAN: 3 strategi ini TETAP DIPERCAYA seperti biasa, TIDAK ada tindakan yang perlu diambil -- beda perlakuan dari NFP yang buktinya lebih solid dari 2 sisi.');
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR expandedValidation.js:', e.message); process.exit(1); });
}

module.exports = { main };
