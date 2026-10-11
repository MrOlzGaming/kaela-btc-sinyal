// Uji shortLadderTrader.js -- exchange & harga PALSU, gak ada order/WA asli. node shortLadderTrader.selftest.js
const assert = require('assert');
const { runOnce, freshJournal } = require('./shortLadderTrader');
const CFG = { enabled: true, allowReal: true, symbol: 'BTC-USDC', marginAsset: 'USDC', betPct: 10, gapPct: 5, tpPct: 10, leverage: 1, winFrom: 520, winTo: 900, marginCapPct: 70, remindDays: 30 };
const H = Date.parse('2028-04-12');

function harness({ wallet = 1000, px = 100000, day = 600, longMg = 0 } = {}) {
  const st = { wallet, px, qty: 0, avg: 0, mg: 0, orders: [], wa: [], alerts: [], day, longMg };
  const exec = {
    getPositionBySide: async (s, side) => side === 'LONG' ? (st.longMg > 0 ? { positionAmt: '0.01', margin: String(st.longMg), unrealizedProfit: '0' } : null)
      : (st.qty > 0 ? { positionAmt: String(-st.qty), avgPrice: String(st.avg), liquidationPrice: String(st.avg * 1.99), margin: String(st.mg), unrealizedProfit: String(st.qty * (st.avg - st.px)) } : null),
    getWalletBalance: async () => st.wallet,
    setIsolatedMargin: async () => {}, setLeverage: async (s, l, side) => { st.lev = l; st.levSide = side; },
    getSymbolInfo: async () => ({ stepSize: 0.0001, minNotionalUsd: 2 }),
    placeMarketEntry: async ({ direction, notionalUsd, livePrice }) => { assert.strictEqual(direction, 'sell'); const q = Math.floor(notionalUsd / livePrice / 0.0001 + 1e-9) * 0.0001; st.avg = (st.avg * st.qty + livePrice * q) / (st.qty + q); st.qty += q; st.mg += notionalUsd; st.wallet -= q * livePrice * 0.0005; st.orders.push({ side: 'sell', q, px: livePrice }); return { avgPrice: String(livePrice), executedQty: String(q) }; },
    emergencyCloseMarket: async ({ direction, quantity }) => { assert.strictEqual(direction, 'sell'); st.wallet += quantity * (st.avg - st.px) - quantity * st.px * 0.0005; st.qty = 0; st.mg = 0; st.orders.push({ side: 'buy', q: quantity, px: st.px }); return { avgPrice: String(st.px) }; },
  };
  const j = freshJournal();
  const deps = { cfg: CFG, journal: j, exec, isDemo: false, now: () => H + st.day * 864e5, days: () => st.day, hIdx: () => 5, dateOfDay: (d) => new Date(H + d * 864e5),
    price: async () => st.px, notify: async (m) => st.wa.push(m), alert: async (m) => st.alerts.push(m), log: () => {}, save: () => {} };
  return { st, j, deps };
}
const tests = []; const test = (n, f) => tests.push([n, f]);

test('di luar musim bear (hari 300) -> gak order sama sekali', async () => {
  const h = harness({ day: 300 }); const r = await runOnce(h.deps);
  assert(r.idle && h.st.orders.length === 0, JSON.stringify(r));
});
test('30 hari sebelum musim (hari 495) -> Olan dikabarin SEKALI, belum order', async () => {
  const h = harness({ day: 495 }); await runOnce(h.deps); await runOnce(h.deps);
  assert.strictEqual(h.st.alerts.filter((m) => /Tangga SHORT.*mulai jalan 2029-09-14/.test(m)).length, 1, h.st.alerts.join('|'));
  assert.strictEqual(h.st.orders.length, 0);
});
test('masuk musim (hari 600) -> tangga #1 = 10% saldo, 1x SHORT, pesan buka', async () => {
  const h = harness(); const r = await runOnce(h.deps);
  assert(r.opened && Math.abs(r.opened.qty - 0.001) < 1e-9 && h.st.lev === 1 && h.st.levSide === 'SHORT', JSON.stringify(r));
  assert(h.st.wa.some((m) => /SHORT/.test(m) && /FARMER SHORT/.test(m)), h.st.wa.join('\n'));
});
test('BTC naik 5% -> tangga #2; naik 3% doang -> gak nambah', async () => {
  const h = harness(); await runOnce(h.deps);
  h.st.px = 103000; assert((await runOnce(h.deps)).idle);
  h.st.px = 105000; const r = await runOnce(h.deps); assert(r.added && r.added.n === 2, JSON.stringify(r));
});
test('maks 10 tangga (100% saldo awal) walau naik terus', async () => {
  const h = harness({ wallet: 100000 }); h.deps.cfg = { ...CFG, marginCapPct: 1000 }; await runOnce(h.deps);
  for (let i = 1; i <= 14; i++) { h.st.px = 100000 * Math.pow(1.05, i); await runOnce(h.deps); }
  assert.strictEqual(h.j.cycle.n, 10);
});
test('turun sampe untung 10% total masuk -> TP tutup semua, siklus baru pakai saldo terbaru', async () => {
  const h = harness(); await runOnce(h.deps); h.st.px = 105000; await runOnce(h.deps);
  h.st.px = 90000; const r = await runOnce(h.deps);
  assert(r.tp && r.tp.net >= 0.1 * 200 - 1e-6, JSON.stringify(r));
  assert(h.j.cycle === null && h.j.stats.tp === 1 && h.st.qty === 0);
  const r2 = await runOnce(h.deps); assert(r2.opened && Math.abs(h.j.cycle.unit - h.st.wallet * 0.1) < 1, 'saldo terbaru');
});
test('PENGAMAN: margin long Farmer + short > 70% ekuitas -> short ditahan', async () => {
  const h = harness({ longMg: 650 }); const r = await runOnce(h.deps);
  assert(r.idle === 'batas margin 70%' && h.st.orders.length === 0, JSON.stringify(r));
});
test('musim bear habis (hari 900) pas lagi rugi -> short DITUTUP PAKSA', async () => {
  const h = harness(); await runOnce(h.deps); h.st.px = 104000; h.st.day = 900;
  const r = await runOnce(h.deps);
  assert(r.forced && r.forced.net < 0 && h.st.qty === 0 && h.j.stats.forced === 1, JSON.stringify(r));
  assert(h.st.wa.some((m) => /Musim bear habis/.test(m)));
});
test('posisi ditutup di luar sistem -> dicatat, Olan dikabarin, gak buka dobel', async () => {
  const h = harness(); await runOnce(h.deps); h.st.qty = 0;
  const r = await runOnce(h.deps);
  assert(r.external && h.j.cycle === null && h.st.alerts.some((m) => /di luar sistem/.test(m)), JSON.stringify(r));
});
test('akun real & allowReal false -> gak jalan', async () => {
  const h = harness(); h.deps.cfg = { ...CFG, allowReal: false }; const r = await runOnce(h.deps);
  assert(r.skipped && h.st.orders.length === 0);
});

(async () => { let ok = 0, fail = 0; for (const [n, f] of tests) { try { await f(); ok++; console.log(`  OK   ${n}`); } catch (e) { fail++; console.log(`  GAGAL ${n}\n       ${e.message}`); } } console.log(`\n${ok} lolos, ${fail} gagal`); if (fail) process.exitCode = 1; })();
