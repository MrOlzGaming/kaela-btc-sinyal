// Uji spotGridTrader.js -- exchange PALSU. node spotGridTrader.selftest.js
const assert = require('assert');
const { runOnce, freshJournal } = require('./spotGridTrader');
const CFG = { enabled: true, symbol: 'BTC-USDC', quote: 'USDC', activateAtUsd: 10000, capUsd: 100000, holdPct: 30, unitPct: 2, stepPct: 3, growth: 1.15, tpPct: 1.5, minOrderUsd: 5.5 };
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
(async () => { let ok = 0, fail = 0; for (const [n, f] of tests) { try { await f(); ok++; console.log(`  OK   ${n}`); } catch (e) { fail++; console.log(`  GAGAL ${n}\n       ${e.message}`); } } console.log(`\n${ok} lolos, ${fail} gagal`); if (fail) process.exitCode = 1; })();
