// Uji bingxPositionGuard.js -- exchange PALSU, gak ada order/WA asli. node bingxPositionGuard.selftest.js
const assert = require('assert');
const { guardAccount, kaelaPositionsFromJournals } = require('./bingxPositionGuard');

function ex(positions, kaelaSymbols = []) {
  const st = { closed: [] };
  return { st, exec: {
    getAllPositions: async () => positions,
    wasLastEntryOrderByKaela: async (sym) => kaelaSymbols.includes(sym),
    getSymbolInfo: async () => ({ stepSize: 0.0001, quantityPrecision: 4 }),
    roundToStepSize: (q, s, p) => parseFloat((Math.floor(q / s + 1e-9) * s).toFixed(p)),
    emergencyCloseMarket: async (a) => { st.closed.push(a); return { order: { orderId: 'x' } }; },
  } };
}
const pos = (symbol, side, amt) => ({ symbol, positionSide: side, positionAmt: String(amt), unrealizedProfit: '0' });
const tests = []; const test = (n, f) => tests.push([n, f]);
const run = (e, owned, state, now) => guardAccount({ mode: 'real', exec: e.exec, owned, state, now, alert: async (m) => (state.alerts = (state.alerts || []).concat(m)), log: () => {} });

test('posisi Farmer (cocok jurnal) gak disentuh', async () => {
  const e = ex([pos('BTC-USDC', 'LONG', 0.0034)]); const s = {};
  await run(e, [{ mode: 'real', symbol: 'BTC-USDC', side: 'LONG', qty: 0.0034, owner: 'Farmer' }], s, 1e6);
  await run(e, [{ mode: 'real', symbol: 'BTC-USDC', side: 'LONG', qty: 0.0034, owner: 'Farmer' }], s, 1e6 + 60e3);
  assert.strictEqual(e.st.closed.length, 0);
});
test('ETH dibuka Olan: siklus 1 cuma curiga, siklus 2 (>=50 dtk) ditutup + DM', async () => {
  const e = ex([pos('ETH-USDC', 'LONG', 0.01)]); const s = {};
  const r1 = await run(e, [], s, 1e6); assert(r1[0].pending && e.st.closed.length === 0);
  const r2 = await run(e, [], s, 1e6 + 60e3);
  assert(r2[0].closed === 0.01 && e.st.closed[0].symbol === 'ETH-USDC' && e.st.closed[0].direction === 'buy');
  assert(/ETH-USDC/.test(s.alerts[0]) && /dikelola Kaela 100%/.test(s.alerts[0]));
});
test('posisi gak di jurnal tapi order pembukanya bertag Kaela -> aman', async () => {
  const e = ex([pos('SOL-USDT', 'LONG', 1)], ['SOL-USDT']); const s = {};
  await run(e, [], s, 1e6); await run(e, [], s, 1e6 + 60e3);
  assert.strictEqual(e.st.closed.length, 0);
});
test('Olan nambahin qty ke posisi Farmer -> cuma KELEBIHANNYA yang ditutup', async () => {
  const e = ex([pos('BTC-USDC', 'LONG', 0.0054)]); const s = {}; const owned = [{ mode: 'real', symbol: 'BTC-USDC', side: 'LONG', qty: 0.0034, owner: 'Farmer' }];
  await run(e, owned, s, 1e6); await run(e, owned, s, 1e6 + 60e3);
  assert(e.st.closed.length === 1 && Math.abs(e.st.closed[0].quantity - 0.002) < 1e-9, JSON.stringify(e.st.closed));
});
test('short asing di simbol yang sama kayak long Farmer -> short-nya ditutup (arah beda), long aman', async () => {
  const e = ex([pos('BTC-USDC', 'LONG', 0.0034), pos('BTC-USDC', 'SHORT', 0.001)]); const s = {}; const owned = [{ mode: 'real', symbol: 'BTC-USDC', side: 'LONG', qty: 0.0034, owner: 'Farmer' }];
  await run(e, owned, s, 1e6); await run(e, owned, s, 1e6 + 60e3);
  assert(e.st.closed.length === 1 && e.st.closed[0].direction === 'sell' && e.st.closed[0].quantity === 0.001, JSON.stringify(e.st.closed));
});
test('posisi asing hilang sendiri sebelum dikonfirmasi -> catatan curiga dibuang', async () => {
  const s = {}; await run(ex([pos('ETH-USDC', 'LONG', 0.01)]), [], s, 1e6);
  await run(ex([]), [], s, 1e6 + 60e3);
  assert.strictEqual(Object.keys(s.suspects).length, 0);
});
test('jurnal: Farmer real+demo kebaca, guard pending juga dianggap punya Kaela', async () => {
  const files = { 'grid-journal.json': { cycle: { pos: { qty: 0.0034 } } }, 'grid-config.json': { symbol: 'BTC-USDC' }, 'grid-demo-journal.json': { cycle: { pos: null, guard: { qty: 1.4483 } } }, 'grid-demo-config.json': { symbol: 'BTC-USDT' } };
  const o = kaelaPositionsFromJournals((f) => files[f] || null);
  assert(o.some((x) => x.mode === 'real' && x.symbol === 'BTC-USDC' && x.qty === 0.0034) && o.some((x) => x.mode === 'demo' && x.symbol === 'BTC-USDT' && x.qty === 1.4483), JSON.stringify(o));
});

(async () => {
  let ok = 0, fail = 0;
  for (const [n, f] of tests) { try { await f(); ok++; console.log(`  OK   ${n}`); } catch (e) { fail++; console.log(`  GAGAL ${n}\n       ${e.message}`); } }
  console.log(`\n${ok} lolos, ${fail} gagal`); if (fail) process.exitCode = 1;
})();
