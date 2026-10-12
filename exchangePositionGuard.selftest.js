// Uji exchangePositionGuard.js (Bybit/Bitget) -- exchange PALSU, gak ada order/WA asli. node exchangePositionGuard.selftest.js
const assert = require('assert');
const { guardAccount } = require('./bingxPositionGuard');
const { kaelaPositions, NORM } = require('./exchangePositionGuard');
function ex(positions, kaelaSymbols = []) {
  const st = { closed: [] };
  return { st, exec: {
    getAllPositions: async () => positions,
    wasLastEntryOrderByKaela: async (sym) => kaelaSymbols.includes(sym),
    getSymbolInfo: async () => ({ stepSize: 0.001, quantityPrecision: 3 }),
    roundToStepSize: (q, s, p) => parseFloat((Math.floor(q / s + 1e-9) * s).toFixed(p)),
    emergencyCloseMarket: async (a) => { st.closed.push(a); return { order: { orderId: 'x' } }; },
  } };
}
const run = (exchange, mode, e, owned, state, now) => guardAccount({ mode, exec: e.exec, owned, state, now, norm: NORM[exchange], exLabel: exchange === 'bybit' ? 'Bybit' : 'Bitget', alert: async (m) => (state.alerts = (state.alerts || []).concat(m)), log: () => {} });
const tests = []; const test = (n, f) => tests.push([n, f]);
const journals = (files) => (f) => files[f] || null;

test('Bybit: posisi Ranger Rotasi (jurnal) gak disentuh, demo maupun real', async () => {
  const read = journals({ 'ranger-rotation-config.json': { exchange: 'bybit' }, 'ranger-rotation-journal.json': { floating: { coin: 'SOL', direction: 'buy', legs: { demo: { remainingQty: 12 }, real: { remainingQty: 0.5 } } } } });
  const owned = [...kaelaPositions('bybit', read)];
  assert.strictEqual(owned.length, 2);
  for (const [mode, size] of [['demo', '12'], ['real', '0.5']]) {
    const e = ex([{ symbol: 'SOLUSDT', side: 'Buy', size, unrealisedPnl: '1' }]); const s = {};
    await run('bybit', mode, e, owned, s, 1e6); await run('bybit', mode, e, owned, s, 1e6 + 60e3);
    assert.strictEqual(e.st.closed.length, 0, mode);
  }
});
test('Bybit: Olan buka ETH short -> curiga dulu, siklus 2 ditutup (arah sell), lapor grup', async () => {
  const e = ex([{ symbol: 'ETHUSDT', side: 'Sell', size: '0.3', unrealisedPnl: '-2' }]); const s = {};
  const r1 = await run('bybit', 'real', e, [], s, 1e6); assert(r1[0].pending && !e.st.closed.length);
  const r2 = await run('bybit', 'real', e, [], s, 1e6 + 60e3);
  assert(r2[0].closed === 0.3 && e.st.closed[0].direction === 'sell' && e.st.closed[0].symbol === 'ETHUSDT');
  assert(/Bybit \(Real\)/.test(s.alerts[0]) && /dikelola Kaela 100%/.test(s.alerts[0]), s.alerts[0]);
});
test('Bybit: Olan nambahin qty posisi Rotasi -> cuma kelebihannya yang dipotong', async () => {
  const owned = [{ mode: 'real', symbol: 'SOLUSDT', side: 'LONG', qty: 0.5, owner: 'Rotasi' }];
  const e = ex([{ symbol: 'SOLUSDT', side: 'Buy', size: '2.5' }]); const s = {};
  await run('bybit', 'real', e, owned, s, 1e6); await run('bybit', 'real', e, owned, s, 1e6 + 60e3);
  assert.strictEqual(e.st.closed[0].quantity, 2);
});
test('Bitget: leg Emas twin (jurnal) aman; posisi BTC manual ditutup; order bertag kaela- aman', async () => {
  const read = journals({ 'gold-twin-position-journal.json': { ranger: { floating: { direction: 'buy', fixedTp: { execMode: 'bitget-real' } } } } });
  const owned = kaelaPositions('bitget', read);
  assert.deepStrictEqual(owned.map((o) => o.symbol + o.side), ['PAXGUSDTLONG']);
  const e = ex([{ symbol: 'PAXGUSDT', holdSide: 'long', total: '0.01' }, { symbol: 'BTCUSDT', holdSide: 'short', total: '0.002' }, { symbol: 'XRPUSDT', holdSide: 'long', total: '10' }], ['XRPUSDT']); const s = {};
  await run('bitget', 'real', e, owned, s, 1e6); await run('bitget', 'real', e, owned, s, 1e6 + 60e3);
  assert.deepStrictEqual(e.st.closed.map((c) => c.symbol + c.direction), ['BTCUSDTsell']);
});
test('posisi asing ilang sendiri sebelum konfirmasi -> gak ditutup, catatan curiga dibersihin', async () => {
  const s = {}; const e1 = ex([{ symbol: 'ETHUSDT', side: 'Buy', size: '1' }]);
  await run('bybit', 'demo', e1, [], s, 1e6);
  const e2 = ex([]); await run('bybit', 'demo', e2, [], s, 1e6 + 60e3);
  assert(!e2.st.closed.length && !Object.keys(s.suspects).length);
});

(async () => { let ok = 0, fail = 0; for (const [n, f] of tests) { try { await f(); ok++; console.log(`  OK   ${n}`); } catch (e) { fail++; console.log(`  GAGAL ${n}\n       ${e.message}`); } } console.log(`\n${ok} lolos, ${fail} gagal`); if (fail) process.exitCode = 1; })();
