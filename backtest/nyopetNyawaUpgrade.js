// Riset upgrade Nyopet: nyawa% FLAT 2% (live sekarang) vs nyawa% ATR-based (dinamis ikut
// volatilitas) -- 30 Agu 2026, permintaan Olan "kita backtest lagi.. upgrade sistem nyopetnya".
//
// KENAPA INI BEDA dari backtest/darkKaelaLiquidity.js (riset lama, 15 Agu 2026): riset lama pakai
// SL = harga ZONA itu sendiri (invalidation struktural) -- itu BUKAN cara live beneran keluar
// posisi. Live nyopetAutoTrader.js SAMA SEKALI GAK PASANG order SL -- exit "rugi" murni dari
// LIKUIDASI leverage (nyawa% -> leverage = min(50, floor(100/nyawa%)), posisi kelikuidasi persis
// di jarak nyawa% dari entry). Backtest ini PERTAMA KALI model itu dengan benar: TP = zona lawan
// (sama kayak sebelumnya, itu emang match live), tapi "SL" = titik likuidasi nyawa%, BUKAN harga
// zona. Signal generation (deteksi zona + arah) REUSE LANGSUNG dari darkKaelaZones.js (SATU
// sumber kebenaran yang sama dipakai live darkKaelaMonitor.js/nyopetAutoTrader.js) -- bukan
// reimplementasi lokal, biar sinyal yang diuji PERSIS sinyal yang beneran akan muncul live.
//
// Data hourly (ZONE_WINDOW_CANDLES) dipakai buat zona+trigger (pola sama kayak darkKaelaLiquidity.js
// -- live pakai 5 menit buat presisi timing doang, hourly cukup buat VALIDASI KONSEP, gak worth
// nyimpen histori 5 menit bertahun-tahun cuma buat riset).

const fs = require('fs');
const path = require('path');
const { detectZones, findNearestCandidate, pctDist, DEFAULT_PARAMS } = require('../darkKaelaZones');
const { atr } = require('../technicalAnalysis');
const { hitung: hitungExposure } = require('../calculator');

const CANDLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'hourly-cache.json'), 'utf8'));

// ============ Generate sinyal (REUSE darkKaelaZones.js, sama persis logic live) ============
// 1 sinyal aktif per momen (dedup per level harga -- sama pola "lastZone" darkKaelaLiquidity.js).
function generateSignals() {
  const signals = [];
  let lastZone = null;
  for (let i = DEFAULT_PARAMS.ZONE_WINDOW_CANDLES; i < CANDLES.length; i++) {
    const c = CANDLES[i];
    const zones = detectZones(CANDLES, i);
    const nearest = findNearestCandidate(c, zones);
    if (!nearest) continue;
    const sameZone = lastZone && pctDist(nearest.price, lastZone.price) <= DEFAULT_PARAMS.CLUSTER_TOLERANCE_PCT;
    if (sameZone) continue;
    const tpPool = nearest.direction === 'long' ? zones.resistance : zones.support;
    const tpZone = tpPool.slice().sort((a, b) => pctDist(a.price, c.close) - pctDist(b.price, c.close))[0] || null;
    signals.push({
      index: i, time: c.closeTime, direction: nearest.direction,
      zonePrice: nearest.price, zoneKind: nearest.kind, touches: nearest.touches,
      price: c.close, tpPrice: tpZone ? tpZone.price : null,
    });
    lastZone = { price: nearest.price, direction: nearest.direction };
  }
  return signals;
}

// ============ Simulasi 1 trade -- TP=zona lawan, exit-rugi=LIKUIDASI nyawa% (BUKAN harga zona) ============
// nyawaPctFn(signalIndex) -> persen (dipanggil SEKALI pas entry, no lookahead -- ATR pakai data
// SAMPAI candle sinyal doang). TRADE_TIMEOUT sama kayak darkKaelaLiquidity.js (14 hari).
const TRADE_TIMEOUT_CANDLES = 24 * 14;

function simulateTradeLiq(signal, nyawaPct) {
  if (signal.tpPrice == null) return { result: 'no-tp', r: null, nyawaPct };
  const entry = signal.price;
  const dir = signal.direction;
  const liqPrice = dir === 'long' ? entry * (1 - nyawaPct / 100) : entry * (1 + nyawaPct / 100);
  const riskDist = Math.abs(entry - liqPrice);
  if (riskDist === 0) return { result: 'zero-risk', r: null, nyawaPct };
  const tp = signal.tpPrice;
  const endIdx = Math.min(CANDLES.length, signal.index + 1 + TRADE_TIMEOUT_CANDLES);

  for (let j = signal.index + 1; j < endIdx; j++) {
    const c = CANDLES[j];
    if (dir === 'long') {
      const hitLiq = c.low <= liqPrice;
      const hitTp = c.high >= tp;
      if (hitLiq && hitTp) return { result: 'liq', r: -1, nyawaPct }; // sama candle -- konservatif, liq menang
      if (hitLiq) return { result: 'liq', r: -1, nyawaPct };
      if (hitTp) return { result: 'tp', r: (tp - entry) / riskDist, nyawaPct };
    } else {
      const hitLiq = c.high >= liqPrice;
      const hitTp = c.low <= tp;
      if (hitLiq && hitTp) return { result: 'liq', r: -1, nyawaPct };
      if (hitLiq) return { result: 'liq', r: -1, nyawaPct };
      if (hitTp) return { result: 'tp', r: (entry - tp) / riskDist, nyawaPct };
    }
  }
  return { result: 'timeout', r: null, nyawaPct };
}

// ATR-based nyawa% -- dihitung dari candle SAMPAI SEBELUM sinyal (no lookahead), diclamp biar
// gak ekstrem (terlalu tipis = whipsaw kena liq tiap saat, terlalu lebar = leverage jadi 1x doang
// gak masuk akal buat gaya "Nyopet" yang emang niatnya leverage tinggi).
function atrNyawaPct(signal, mult, minPct, maxPct) {
  const upTo = CANDLES.slice(0, signal.index); // no lookahead -- gak termasuk candle sinyal sendiri
  const a = atr(upTo, 14);
  if (a === null) return null;
  const raw = (a / signal.price) * 100 * mult;
  return Math.max(minPct, Math.min(maxPct, raw));
}

function summarizeR(label, results) {
  const resolved = results.filter((t) => t.result === 'tp' || t.result === 'liq');
  const wins = resolved.filter((t) => t.result === 'tp');
  const losses = resolved.filter((t) => t.result === 'liq');
  const totalR = resolved.reduce((s, t) => s + t.r, 0);
  const grossWinR = wins.reduce((s, t) => s + t.r, 0);
  const grossLossR = Math.abs(losses.reduce((s, t) => s + t.r, 0));
  const pf = grossLossR > 0 ? grossWinR / grossLossR : (grossWinR > 0 ? Infinity : 0);
  const avgNyawa = resolved.reduce((s, t) => s + t.nyawaPct, 0) / (resolved.length || 1);
  console.log(`\n[${label}]`);
  console.log(`  Trade resolved: ${resolved.length} (dari ${results.length} sinyal) | avg nyawa%: ${avgNyawa.toFixed(2)}%`);
  console.log(`  Win rate: ${(wins.length / resolved.length * 100).toFixed(1)}% | Profit Factor: ${pf === Infinity ? '∞' : pf.toFixed(2)} | Total R: ${totalR >= 0 ? '+' : ''}${totalR.toFixed(1)}R | Expectancy: ${(totalR / resolved.length).toFixed(3)}R/trade`);
  return { resolved, wins, losses, totalR, pf, avgNyawa };
}

// ============ Simulasi bankroll REALISTIS (exposure system asli, 1 posisi at a time -- sama
// kayak live: 1 Nyopet slot per aset) -- modal mulai $100, TANPA top-up (murni kualitas sinyal
// nyawa, biar gak ketutup efek topup kayak backtestNyopet.js runBacktestRealistic). ============
function simulateBankroll(signals, nyawaPctFn, startCapital = 100) {
  let capital = startCapital;
  let peak = startCapital, maxDD = 0;
  const trades = [];
  let lastExitIdx = -1;

  for (const signal of signals) {
    if (signal.index <= lastExitIdx) continue; // masih ada posisi lain "terbuka" (1 slot doang, sama kayak live)
    const nyawaPct = nyawaPctFn(signal);
    if (nyawaPct === null) continue;
    const t = simulateTradeLiq(signal, nyawaPct);
    if (t.result !== 'tp' && t.result !== 'liq') continue;
    if (capital <= 0.01) break;

    const { nilaiPosisi } = hitungExposure({ modal: capital, nyawa: nyawaPct, entry: signal.price });
    let pnl;
    if (t.result === 'liq') {
      pnl = -(nilaiPosisi * (nyawaPct / 100)); // rugi = margin (persis mekanisme likuidasi)
    } else {
      const rewardPct = Math.abs(signal.tpPrice - signal.price) / signal.price * 100;
      pnl = nilaiPosisi * (rewardPct / 100);
    }
    capital = Math.max(0, capital + pnl);
    peak = Math.max(peak, capital);
    maxDD = Math.max(maxDD, (peak - capital) / peak * 100);
    trades.push({ ...t, pnl, capitalAfter: capital });

    // Cari kapan posisi ini SEBENARNYA closed (buat kunci slot -- reuse index dari simulateTradeLiq
    // butuh re-walk, gampangnya: cari ulang exit index dgn logic sama).
    lastExitIdx = findExitIndex(signal, nyawaPct, t.result);
  }
  return { finalCapital: capital, maxDrawdownPct: maxDD, trades };
}

function findExitIndex(signal, nyawaPct, expectedResult) {
  const entry = signal.price, dir = signal.direction;
  const liqPrice = dir === 'long' ? entry * (1 - nyawaPct / 100) : entry * (1 + nyawaPct / 100);
  const tp = signal.tpPrice;
  const endIdx = Math.min(CANDLES.length, signal.index + 1 + TRADE_TIMEOUT_CANDLES);
  for (let j = signal.index + 1; j < endIdx; j++) {
    const c = CANDLES[j];
    const hitLiq = dir === 'long' ? c.low <= liqPrice : c.high >= liqPrice;
    const hitTp = dir === 'long' ? c.high >= tp : c.low <= tp;
    if (hitLiq || hitTp) return j;
  }
  return endIdx;
}

function byYear(signals, nyawaPctFn) {
  const years = {};
  signals.forEach((s) => {
    const nyawaPct = nyawaPctFn(s);
    if (nyawaPct === null) return;
    const t = simulateTradeLiq(s, nyawaPct);
    if (t.r === null) return;
    const y = new Date(s.time).getUTCFullYear();
    if (!years[y]) years[y] = { count: 0, totalR: 0, wins: 0 };
    years[y].count++;
    years[y].totalR += t.r;
    if (t.result === 'tp') years[y].wins++;
  });
  return years;
}

function printByYear(label, years) {
  console.log(`\n[${label}] -- breakdown per tahun`);
  Object.keys(years).sort().forEach((y) => {
    const d = years[y];
    console.log(`  ${y}: ${d.count} trade | win rate ${(d.wins / d.count * 100).toFixed(1)}% | Total R: ${d.totalR >= 0 ? '+' : ''}${d.totalR.toFixed(1)}R`);
  });
}

if (require.main === module) {
  console.log('=== Nyopet: nyawa FLAT 2% (live sekarang) vs nyawa ATR-based (kandidat upgrade) ===');
  console.log('Rentang data:', new Date(CANDLES[DEFAULT_PARAMS.ZONE_WINDOW_CANDLES].closeTime).toISOString().slice(0, 10), '->', new Date(CANDLES[CANDLES.length - 1].closeTime).toISOString().slice(0, 10));

  const signals = generateSignals();
  console.log(`Total sinyal (2017-sekarang): ${signals.length}`);

  const EXCLUDE_2017 = new Date('2018-01-01T00:00:00Z').getTime();
  const signalsEx2017 = signals.filter((s) => s.time >= EXCLUDE_2017);
  console.log(`Sinyal (exclude 2017, konsisten sama riset lama darkKaelaLiquidity.js): ${signalsEx2017.length}`);

  // --- R-multiple: baseline flat 2% vs beberapa kandidat ATR ---
  const flatFn = () => 2;
  const atr12 = (s) => atrNyawaPct(s, 1.2, 1, 6);
  const atr15 = (s) => atrNyawaPct(s, 1.5, 1, 6);
  const atr20 = (s) => atrNyawaPct(s, 2.0, 1, 6);

  const rFlat = summarizeR('BASELINE: nyawa FLAT 2% (live sekarang)', signalsEx2017.map((s) => simulateTradeLiq(s, 2)));
  const rAtr12 = summarizeR('KANDIDAT: nyawa = 1.2x ATR(14) hourly, clamp 1-6%', signalsEx2017.map((s) => { const n = atr12(s); return n === null ? { result: 'no-tp', r: null, nyawaPct: 0 } : simulateTradeLiq(s, n); }));
  const rAtr15 = summarizeR('KANDIDAT: nyawa = 1.5x ATR(14) hourly, clamp 1-6%', signalsEx2017.map((s) => { const n = atr15(s); return n === null ? { result: 'no-tp', r: null, nyawaPct: 0 } : simulateTradeLiq(s, n); }));
  const rAtr20 = summarizeR('KANDIDAT: nyawa = 2.0x ATR(14) hourly, clamp 1-6%', signalsEx2017.map((s) => { const n = atr20(s); return n === null ? { result: 'no-tp', r: null, nyawaPct: 0 } : simulateTradeLiq(s, n); }));

  // --- Bankroll realistis $100 start, no top-up, 1 slot at a time (exclude 2017) ---
  console.log('\n\n=== Simulasi bankroll realistis ($100 start, tanpa top-up, 1 posisi at a time, exclude 2017) ===');
  const bFlat = simulateBankroll(signalsEx2017, flatFn);
  const bAtr12 = simulateBankroll(signalsEx2017, atr12);
  const bAtr15 = simulateBankroll(signalsEx2017, atr15);
  const bAtr20 = simulateBankroll(signalsEx2017, atr20);

  [['FLAT 2%', bFlat], ['ATR x1.2', bAtr12], ['ATR x1.5', bAtr15], ['ATR x2.0', bAtr20]].forEach(([label, b]) => {
    console.log(`\n[${label}] Final: $${b.finalCapital.toFixed(2)} (${((b.finalCapital / 100 - 1) * 100).toFixed(0)}%) | Max Drawdown: ${b.maxDrawdownPct.toFixed(1)}% | Trades executed: ${b.trades.length}`);
  });

  // --- Breakdown per tahun (WAJIB, biar gak ketipu 1 tahun anomali) ---
  printByYear('FLAT 2%', byYear(signalsEx2017, flatFn));
  printByYear('ATR x1.5 (kandidat terbaik dugaan)', byYear(signalsEx2017, atr15));
}

module.exports = { generateSignals, simulateTradeLiq, atrNyawaPct, simulateBankroll, summarizeR };
