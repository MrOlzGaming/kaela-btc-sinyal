// Distribusi nyawa% (jarak entry->SL) historis SEMUA sinyal 4 slot -- dipakai buat cari nyawa
// PALING TEBAL (lebar) sbg acuan margin worst-case (31 Agu 2026, permintaan Olan: "dari rata-rata
// nyawa yang dibuat.. cari nyawa paling tebal sebagai acuan minimal saldo +25%").
//
// KENAPA INI PENTING (celah yang belum kecek di kalkulasi saldo minimum web sebelumnya): margin
// = nilaiPosisi/leverage, leverage = floor(100/nyawaPct) -- nyawa makin LEBAR -> leverage makin
// KECIL -> margin makin BESAR (relatif ke nilaiPosisi). Kalkulasi minimum saldo yang ADA sekarang
// (dashboard.html) cuma cek notional floor (stepSize/MIN_NOTIONAL) pakai 1 CONTOH nyawa dari log,
// BUKAN worst-case beneran dari histori sinyal -- kalau nyawa yang KEBETULAN muncul di real trade
// lebih lebar dari yang pernah dites, margin BISA jebol lebih dari saldo real yang "katanya cukup".

const path = require('path');
const ROOT = path.join(__dirname, '..');

function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p / 100 * sorted.length));
  return sorted[idx];
}
function stats(label, nyawaArr) {
  if (nyawaArr.length === 0) { console.log(`${label}: TIDAK ADA sinyal.`); return null; }
  const max = Math.max(...nyawaArr);
  const avg = nyawaArr.reduce((s, n) => s + n, 0) / nyawaArr.length;
  const p95 = pct(nyawaArr, 95);
  const p99 = pct(nyawaArr, 99);
  console.log(`${label}: n=${nyawaArr.length} | rata2=${avg.toFixed(2)}% | p95=${p95.toFixed(2)}% | p99=${p99.toFixed(2)}% | PALING TEBAL(max)=${max.toFixed(2)}%`);
  return { n: nyawaArr.length, avg, p95, p99, max };
}

// ============ Sniper BTC + Emas (reuse backtestCrossAsset.js, ambil nyawa dari SEMUA kandidat
// sinyal yang LOLOS filter, bukan cuma yang jadi trade -- caranya: patch sementara buat nyimpen
// nyawaPct tiap kali candidate diproses. Cara paling gampang TANPA ubah file asli: reuse fungsi
// deteksi LANGSUNG (detectFlag/detectWedge/detectBullishFVG) scan semua candle histori). ============
const { detectFlag, detectWedge } = require(path.join(ROOT, 'chartPatterns.js'));
const { detectBullishFVG } = require(path.join(ROOT, 'backtestFVG.js'));
const { sma } = require(path.join(ROOT, 'technicalAnalysis.js'));
const fs = require('fs');

function sniperNyawaScan(daily, label) {
  const nyawaArr = [];
  const activeFvgs = [];
  for (let idx = 60; idx < daily.length; idx++) {
    const today = daily[idx];
    const fvgNew = detectBullishFVG(daily, idx);
    if (fvgNew) activeFvgs.push(fvgNew);
    for (let i = activeFvgs.length - 1; i >= 0; i--) {
      const z = activeFvgs[i];
      if (idx > z.createdIdx && today.low <= z.gapBottom) { activeFvgs.splice(i, 1); continue; }
      if (!z._touched && today.low <= z.gapTop) z._touched = true;
      if (z._touched && today.close > z.gapTop) {
        nyawaArr.push(Math.abs(today.close - z.gapBottom) / today.close * 100);
        activeFvgs.splice(i, 1);
      }
    }
    const flag = detectFlag(daily, idx, { poleLookbackRange: [5, 20], poleMinMovePct: 15, flagLookbackRange: [3, 15], flagMaxRangePct: 8 });
    if (flag && flag.type === 'bull' && today.close > flag.flagHigh) {
      nyawaArr.push(Math.abs(today.close - flag.flagLow * 0.995) / today.close * 100);
    }
    const wedge = detectWedge(daily, idx, { wedgeLookbackRange: [15, 40], minTouches: 2, convergenceRatio: 0.65 });
    if (wedge && wedge.type === 'falling' && today.close > wedge.projectedResistance) {
      nyawaArr.push(Math.abs(today.close - wedge.recentSwingLow * 0.995) / today.close * 100);
    }
  }
  return stats(label, nyawaArr);
}

const btcDaily = JSON.parse(fs.readFileSync(path.join(ROOT, 'backtest', 'daily-cache.json'), 'utf8'));
const goldDaily = JSON.parse(fs.readFileSync(path.join(ROOT, 'backtest', 'gold-daily-cache.json'), 'utf8'));

console.log('=== NYAWA% HISTORIS -- SEMUA SINYAL (bukan cuma yang jadi trade) ===\n');
console.log('--- SNIPER (harian) ---');
const sniperBtcStats = sniperNyawaScan(btcDaily, 'Sniper BTC');
const sniperGoldStats = sniperNyawaScan(goldDaily, 'Sniper Emas');

// ============ Nyopet v2 (reuse runNyopetV2Backtest -- trades array udah punya originalSl) ============
console.log('\n--- NYOPET v2 (4H) ---');
const { runNyopetV2Backtest, CANDLES_4H, CANDLES_4H_GOLD, RESCALED_4H } = require('./nyopetChartPatternFvg.js');

function nyopetNyawaFromTrades(candles, opts, label) {
  const r = runNyopetV2Backtest(candles, opts);
  const nyawaArr = r.trades.map((t) => Math.abs(t.entryPrice - t.originalSl) / t.entryPrice * 100);
  return stats(label, nyawaArr);
}
const nyopetBtcStats = nyopetNyawaFromTrades(CANDLES_4H, { ...RESCALED_4H, allowShort: false, modalDivisor: 5 }, 'Nyopet BTC');
const nyopetGoldStats = CANDLES_4H_GOLD ? nyopetNyawaFromTrades(CANDLES_4H_GOLD, { ...RESCALED_4H, allowShort: false, modalDivisor: 5 }, 'Nyopet Emas') : null;

console.log('\n=== RINGKASAN -- NYAWA PALING TEBAL (buat acuan margin worst-case) ===');
const results = { sniperBtc: sniperBtcStats, sniperGold: sniperGoldStats, nyopetBtc: nyopetBtcStats, nyopetGold: nyopetGoldStats };
Object.entries(results).forEach(([k, v]) => {
  if (v) console.log(`${k}: max nyawa ${v.max.toFixed(2)}% -> leverage worst-case = floor(100/${v.max.toFixed(2)}) = ${Math.max(1, Math.floor(100 / v.max))}x`);
});

fs.writeFileSync(path.join(__dirname, 'nyawa-distribution-result.json'), JSON.stringify(results, null, 2));
console.log('\nSnapshot disimpan ke backtest/nyawa-distribution-result.json');
