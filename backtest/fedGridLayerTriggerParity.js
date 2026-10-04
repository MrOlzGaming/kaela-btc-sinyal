// backtest/fedGridLayerTriggerParity.js (5 Okt 2026, audit paritas live vs backtest) -- Fed Dovish Grid.
// Backtest yang memvalidasi resep (fedSignalGridBacktest.js simulateBaskets): layer baru ditambah kalau harga gerak 2% LAWAN
// ARAH dari harga LAYER TERAKHIR. Live (rangerAutoTrader.js _processFedDovishGridLocked): 2% dari RATA2 posisi exchange
// ("approksimasi wajar"). Rata2 selalu di atas layer terakhir (LONG) -> live nambah layer LEBIH CEPAT (layer 3 di ~-3,2% vs
// ~-4% dari layer 1, makin jauh di layer 4-5) = exposure lebih gede lebih awal. Seberapa beda hasilnya?
// Data: cache 5m BTC (resample 15m), event NFP+FOMC & sinyal SAMA PERSIS backtest asli. Hasil per % modal, biaya per layer
// SAMA summarizeTrades asli (ROUND_TRIP_COST_PCT_OF_NOTIONAL x layer).
// Pakai: node backtest/fedGridLayerTriggerParity.js <btc-5m.json>
const fs = require('fs');
const { computeSignals, computeSMA, FINAL_RECIPE, generateFomcEvents } = require('./fedSignalGridBacktest');
const { generateNfpEvents } = require('./econReactionBacktest.js');

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c5 = Array.isArray(raw) ? raw : raw.candles;
const M15 = 15 * 60e3;
const candles = [];
for (const c of c5) {
  const t = Math.floor(c.openTime / M15) * M15;
  const last = candles[candles.length - 1];
  if (last && last.openTime === t) { last.high = Math.max(last.high, c.high); last.low = Math.min(last.low, c.low); last.close = c.close; }
  else candles.push({ openTime: t, open: c.open, high: c.high, low: c.low, close: c.close });
}
const closes = candles.map((c) => c.close);
const trendSma = computeSMA(closes, FINAL_RECIPE.trendSmaPeriod);
const events = [...generateNfpEvents(2019, 2026), ...generateFomcEvents()].sort((a, b) => a.timeMs - b.timeMs);
const signals = computeSignals(candles, events);
const SL = FINAL_RECIPE.slPct, TP = FINAL_RECIPE.longTpPct, SHORT_TP = 10;
const COST_PER_LAYER = 0.12 * 0.4; // perkiraan kasar biaya % modal per layer (fee 0,12% notional x rata2 porsi layer ~0,4-1,2) -- sama buat 2 varian

// SALINAN simulateBaskets asli + opsi triggerRef: 'last' (backtest) | 'avg' (live sekarang)
function simulate(triggerRef) {
  const sched = FINAL_RECIPE.layerSchedulePct.map((v) => v / 100);
  const trades = []; let basket = null, sp = 0;
  const maxHold = FINAL_RECIPE.maxHoldDays * 96;
  const recompute = () => { let a = 0, s = 0; for (const l of basket.layers) { a += l.price * l.sizeFrac; s += l.sizeFrac; } basket.avgEntry = a / s; basket.totalSizeFrac = s; };
  const open = (dir, price, i) => { basket = { direction: dir, layers: [{ price, sizeFrac: sched[0] }], openedAtIdx: i, minFloat: 0 }; recompute(); };
  const close = (price, i, reason) => {
    const m = basket.direction === 'LONG' ? 1 : -1;
    trades.push({ direction: basket.direction, openTime: candles[basket.openedAtIdx].openTime, layers: basket.layers.length, pnlPct: basket.totalSizeFrac * ((price - basket.avgEntry) / basket.avgEntry) * 100 * m, reason, minFloat: basket.minFloat });
    basket = null;
  };
  for (let i = 0; i < candles.length; i++) {
    const price = candles[i].close;
    while (sp < signals.length && signals[sp].idxSignal === i) {
      const sig = signals[sp];
      const ok = trendSma[i] == null || (sig.direction === 'LONG' ? price > trendSma[i] : price < trendSma[i]);
      if (ok) { if (!basket) open(sig.direction, price, i); else if (sig.direction !== basket.direction) { close(price, i, 'REVERSAL'); open(sig.direction, price, i); } }
      sp++;
    }
    if (!basket) continue;
    const m = basket.direction === 'LONG' ? 1 : -1;
    const fl = basket.totalSizeFrac * ((price - basket.avgEntry) / basket.avgEntry) * 100 * m;
    basket.minFloat = Math.min(basket.minFloat, fl);
    if (fl >= (basket.direction === 'LONG' ? TP : SHORT_TP)) close(price, i, 'TP');
    else if (fl <= -SL) close(price, i, 'SL');
    else if (i - basket.openedAtIdx >= maxHold) close(price, i, 'TIMEOUT');
    else if (basket.layers.length < sched.length) {
      const ref = triggerRef === 'avg' ? basket.avgEntry : basket.layers[basket.layers.length - 1].price;
      const adverse = basket.direction === 'LONG' ? (ref - price) / ref * 100 : (price - ref) / ref * 100;
      if (adverse >= FINAL_RECIPE.layerTriggerPct) { basket.layers.push({ price, sizeFrac: sched[basket.layers.length] }); recompute(); }
    }
  }
  return trades.filter((t) => t.direction === 'LONG');
}
function st(tr) {
  const nets = tr.map((t) => t.pnlPct - t.layers * COST_PER_LAYER);
  const w = nets.filter((x) => x > 0).reduce((a, b) => a + b, 0), l = -nets.filter((x) => x <= 0).reduce((a, b) => a + b, 0);
  const lay = {}; tr.forEach((t) => { lay[t.layers] = (lay[t.layers] || 0) + 1; });
  return `n${tr.length} menang ${(nets.filter((x) => x > 0).length / (tr.length || 1) * 100).toFixed(0)}% PF ${(l ? w / l : 99).toFixed(2)} total ${nets.reduce((a, b) => a + b, 0).toFixed(0)}% modal | SL ${tr.filter((t) => t.reason === 'SL').length} | layer ${JSON.stringify(lay)}`;
}
const SPLIT = Date.UTC(2023, 0, 1);
console.log(`Candle 15m ${candles.length}, event ${events.length}, sinyal ${signals.length}. Resep ${JSON.stringify(FINAL_RECIPE)}`);
for (const [name, ref] of [['BACKTEST (picu dari layer terakhir)', 'last'], ['LIVE sekarang (picu dari rata2)', 'avg']]) {
  const tr = simulate(ref);
  console.log(`\n== ${name} ==\n  semua  ${st(tr)}\n  <2023  ${st(tr.filter((t) => t.openTime < SPLIT))}\n  >=2023 ${st(tr.filter((t) => t.openTime >= SPLIT))}`);
}
