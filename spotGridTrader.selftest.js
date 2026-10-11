// Uji spotGridTrader.js -- exchange PALSU. node spotGridTrader.selftest.js
const assert = require('assert');
const { runOnce, freshJournal } = require('./spotGridTrader');
const CFG = { enabled: true, symbol: 'BTC-USDC', quote: 'USDC', activateAtUsd: 10000, capUsd: 100000, holdPct: 30, unitPct: 2, stepPct: 3, growth: 1.15, tpPct: 1.5, minOrderUsd: 5.5, coreCycle: { enabled: true, sellFrom: 400, sellTo: 600, buyFrom: 780, buyTo: 950, slices: 5 } };
function harness({ btc = 0, usdc = 0, px = 100000 } = {}) {
  const st = { btc, usdc, px, orders: [], wa: [], alerts: [] };
  const exec = {
    getSpotBalances: async () => [{ asset: 'BTC', free: String(st.btc) }, { asset: 'USDC', free: String(st.usdc) }],
    spotMarketBuy: async ({ quoteQty }) => { const q = quoteQty * 0.999 / st.px; st.usdc -= quoteQty; st.btc += q; st.orders.push({ side: 'BUY', quoteQty }); return { executedQty: String(q) }; },
    spotMarketSell: async ({ quantity }) => { const got = quantity * st.px * 0.999; st.btc -= quantity; st.usdc += got; st.orders.push({ side: 'SELL', quantity }); return { cummulativeQuoteQty: String(got) }; },
  };
  const j = freshJournal();
  const deps = { cfg: CFG, journal: j, exec, price: async () => st.px, now: () => 1e12, notify: async (m) => st.wa.push(m), alert: async (m) => st.alerts.push(m), log: () => {}, save: () => {} };
  return { st, j, deps };
}
const tests = []; const test = (n, f) => tests.push([n, f]);
test('kantong < $10rb -> siaga, gak order', async () => {
  const h = harness({ btc: 0.05, px: 100000 }); const r = await runOnce(h.deps);
  assert(r.idle === 'siaga' && h.st.orders.length === 0);
});
test('tembus $10rb -> inti 30% dikunci, sisa dijual kecuali tangga #1 (2%), DM aktif', async () => {
  const h = harness({ btc: 0.11, px: 100000 }); const r = await runOnce(h.deps);
  assert(r.activated && Math.abs(h.j.coreBtc - 0.033) < 1e-9, JSON.stringify(r));
  assert(Math.abs(h.st.btc - (0.033 + h.j.cycle.btc)) < 1e-6 && h.j.cycle.btc > 0 && h.st.usdc > 7000, JSON.stringify(h.st));
  assert(h.st.alerts.some((m) => /GRID SPOT AKTIF/.test(m)));
});
test('turun 3% -> tangga #2 (x1,15); naik sampai untung 1,5% -> jual BTC grid, INTI tetap utuh', async () => {
  const h = harness({ btc: 0.11, px: 100000 }); await runOnce(h.deps);
  h.st.px = 96900; const r2 = await runOnce(h.deps); assert(r2.bought && r2.bought.n === 2, JSON.stringify(r2));
  h.st.px = 101500; const r3 = await runOnce(h.deps);
  assert(r3.tp && r3.tp.pnl > 0, JSON.stringify(r3));
  assert(Math.abs(h.st.btc - h.j.coreBtc) < 1e-6, 'BTC sisa ' + h.st.btc + ' inti ' + h.j.coreBtc);
  assert(h.st.wa.some((m) => /GRID SPOT — Panen/.test(m)));
});
test('abis panen -> siklus baru dari peluru USDC', async () => {
  const h = harness({ btc: 0.11, px: 100000 }); await runOnce(h.deps); h.st.px = 101800; await runOnce(h.deps);
  const r = await runOnce(h.deps); assert(r.bought && r.bought.n === 1, JSON.stringify(r));
});
test('SIKLUS INTI: musim puncak (hari 450) inti dijual 1/5, USDC-nya gak kepake grid; musim dasar (hari 800) dibeli balik', async () => {
  const h = harness({ btc: 0.11, px: 100000 }); await runOnce(h.deps); // aktif
  const core0 = h.j.coreBtc, H24 = Date.parse('2024-04-20');
  h.deps.now = () => H24 + 450 * 864e5; h.st.px = 120000;
  await runOnce(h.deps);
  assert(Math.abs(h.j.coreBtc - core0 * 0.8) < 1e-6 && h.j.coreUsd > 0, 'inti ' + h.j.coreBtc + ' usd ' + h.j.coreUsd);
  assert(h.st.wa.some((m) => /Inti dijual bertahap \(1\/5\)/.test(m)));
  const coreUsd = h.j.coreUsd;
  h.deps.now = () => H24 + 451 * 864e5; await runOnce(h.deps); // jarak kurang dari 40 hari -> gak jual lagi
  assert(Math.abs(h.j.coreUsd - coreUsd) < 0.01);
  h.deps.now = () => H24 + 800 * 864e5; h.st.px = 50000; await runOnce(h.deps);
  assert(h.j.coreUsd < coreUsd && h.j.coreBtc > core0 * 0.8, 'beli balik: inti ' + h.j.coreBtc);
  assert(h.st.wa.some((m) => /Inti dibeli balik/.test(m)));
});

test('🐕 DOGE: grid lewat cap $100rb -> USDC lebihnya dibeliin DOGE (DCA maks $1000/hari), DM suruh tarik ke dompet', async () => {
  const h = harness({ btc: 0.11, px: 100000 }); await runOnce(h.deps);
  h.st.usdc += 100000; // grid ngegede lewat cap
  const buyDoge = h.deps.exec.spotMarketBuy;
  h.deps.exec.spotMarketBuy = async (a) => { if (a.symbol === 'DOGE-USDC') { h.st.usdc -= a.quoteQty; h.st.orders.push({ side: 'BUY', symbol: 'DOGE', quoteQty: a.quoteQty }); return { executedQty: String(a.quoteQty / 0.2) }; } return buyDoge(a); };
  const r = await runOnce(h.deps);
  assert(r.doge && r.doge.amt === 1000 && h.j.doge.qty === 5000, JSON.stringify(r));
  assert(h.st.alerts.some((m) => /DOMPET DOGE/.test(m)) && h.st.wa.some((m) => /DOGE MOONSHOT/.test(m)));
  const r2 = await runOnce(h.deps); assert(!r2.doge, 'sehari maks 1x');
  h.deps.now = () => 1e12 + 21 * 3600e3; const r3 = await runOnce(h.deps); assert(r3.doge, 'besoknya DCA lagi');
});
test('🐕 DOGE: musim puncak halving -> DM saran jual (1x per siklus); di bawah cap gak beli', async () => {
  const h = harness({ btc: 0.11, px: 100000 }); await runOnce(h.deps);
  h.j.doge = { qty: 5000, costUsd: 1000, buys: 1, lastBuy: 0 };
  h.deps.now = () => Date.parse('2024-04-20') + 450 * 864e5;
  const r = await runOnce(h.deps); assert(!r.doge);
  assert.strictEqual(h.st.alerts.filter((m) => /MUSIM PUNCAK DOGE/.test(m)).length, 1, h.st.alerts.join('|'));
  await runOnce(h.deps); assert.strictEqual(h.st.alerts.filter((m) => /MUSIM PUNCAK DOGE/.test(m)).length, 1);
});

(async () => { let ok = 0, fail = 0; for (const [n, f] of tests) { try { await f(); ok++; console.log(`  OK   ${n}`); } catch (e) { fail++; console.log(`  GAGAL ${n}\n       ${e.message}`); } } console.log(`\n${ok} lolos, ${fail} gagal`); if (fail) process.exitCode = 1; })();
