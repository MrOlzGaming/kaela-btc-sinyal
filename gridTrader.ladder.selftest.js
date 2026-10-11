// Uji mode LADDER gridTrader.js (Grid Tangga isolated) -- exchange & harga PALSU, gak ada order/WA asli.
// node gridTrader.ladder.selftest.js
const assert = require('assert');
const { runOnce, freshJournal } = require('./gridTrader');

const CFG = { enabled: true, allowReal: true, mode: 'LADDER', symbol: 'BTC-USDC', marginAsset: 'USDC', minDd: 15, leverage: 5, betPct: 8, gapPct: 20, ladderTpPct: 20 };

function harness({ wallet = 1000, ath = 126200 } = {}) {
  const st = { wallet, qty: 0, entry: 0, mg: 0, orders: [], wa: [], alerts: [], px: ath, margin: null };
  const exec = {
    getPositionBySide: async () => (st.qty > 0 ? { positionAmt: String(st.qty) } : null),
    getWalletBalance: async () => st.wallet,
    setIsolatedMargin: async () => { st.margin = 'ISOLATED'; }, setCrossMargin: async () => { st.margin = 'CROSSED'; }, setLeverage: async () => ({}),
    getSymbolInfo: async () => ({ stepSize: 0.0001, quantityPrecision: 4, minNotionalUsd: 2 }),
    roundToStepSize: (q, s, p) => parseFloat((Math.floor(q / s + 1e-9) * s).toFixed(p)),
    placeMarketEntry: async ({ notionalUsd, livePrice }) => { const q = Math.floor(notionalUsd / livePrice / 0.0001 + 1e-9) * 0.0001; st.qty = q; st.entry = livePrice; st.mg = q * livePrice / 5; st.wallet -= q * livePrice * 0.0005; st.orders.push({ side: 'buy', q, px: livePrice }); return { avgPrice: String(livePrice), executedQty: String(q) }; },
    emergencyCloseMarket: async ({ quantity }) => { st.wallet += quantity * (st.px - st.entry) - quantity * st.px * 0.0005; st.qty = 0; st.orders.push({ side: 'sell', q: quantity, px: st.px }); return { avgPrice: String(st.px) }; },
  };
  const liquidate = () => { st.wallet -= st.mg; st.qty = 0; };
  const j = freshJournal(); j.ath = ath;
  const deps = { cfg: CFG, journal: j, exec, now: () => 1791700000000, price: async () => st.px, athCandidate: async () => st.px, notify: async (m) => st.wa.push(m), alert: async (m) => st.alerts.push(m), log: () => {}, save: () => {} };
  return { st, j, deps, liquidate };
}

const tests = []; const test = (n, f) => tests.push([n, f]);

test('ATH -10% -> gak entry', async () => {
  const h = harness(); h.st.px = 113580; const r = await runOnce(h.deps);
  assert(r.idle && h.st.orders.length === 0);
});

test('ATH -34% -> bet #1 = 8% saldo ($80) isolated 5x, target +$16', async () => {
  const h = harness(); h.st.px = 83033; const r = await runOnce(h.deps);
  assert(r.bought && r.bought.opening && h.st.margin === 'ISOLATED');
  assert(Math.abs(r.bought.mg - 80) < 1, `margin ${r.bought.mg}`);
  assert(r.bought.tpPx > 86000 && r.bought.tpPx < 86800, `target ${r.bought.tpPx}`);
  assert(/Buka Posisi/.test(h.st.wa[0]) && /🌾 FARMER/.test(h.st.wa[0]) && /\(Real\)/.test(h.st.wa[0]), h.st.wa[0]);
});

test('belum turun 20% -> gak nambah', async () => {
  const h = harness(); h.st.px = 83033; await runOnce(h.deps);
  h.st.px = 70000; const r = await runOnce(h.deps);
  assert(r.idle === 'nunggu tangga' && h.st.orders.length === 1);
});

test('tangga #1 kelikuidasi -> rugi tercatat, pesan likuidasi, tangga #2 LANGSUNG kebuka, target nutup rugi + 20% total masuk', async () => {
  const h = harness(); h.st.px = 83033; await runOnce(h.deps);
  h.st.px = 66400; h.liquidate(); const r2 = await runOnce(h.deps);
  assert(h.st.wa.some((m) => /kena likuidasi/.test(m)));
  assert(r2.bought && r2.bought.bet === 2 && Math.abs(r2.bought.mg - 80) < 1, JSON.stringify(r2));
  // butuh untung ~80 rugi + 32 target = ~112 dari posisi $400 -> naik ~28%
  assert(r2.bought.tpPx > 84500 && r2.bought.tpPx < 85500, `target ${r2.bought.tpPx}`);
  assert(/Nambah Posisi/.test(h.st.wa[h.st.wa.length - 1]));
});

test('target kena -> tutup semua, untung bersih >= 20% total bet, siklus baru pakai saldo terbaru', async () => {
  const h = harness(); h.st.px = 83033; await runOnce(h.deps);
  h.st.px = 66400; h.liquidate(); await runOnce(h.deps);
  h.st.px = 85500; const r = await runOnce(h.deps);
  assert(r.tp && r.tp.net >= 32 - 0.5, JSON.stringify(r.tp));
  assert.strictEqual(h.j.cycle, null); assert(/Tutup Posisi/.test(h.st.wa[h.st.wa.length - 1]) && /Target tangga kena/.test(h.st.wa[h.st.wa.length - 1]));
  assert(h.st.wallet > 1031, `saldo ${h.st.wallet}`);
  const r2 = await runOnce(h.deps);
  assert(r2.bought && r2.bought.opening && r2.bought.mg > 82, `bet baru ${r2.bought.mg}`);
});

test('peluru habis + semua kelikuidasi -> RUNGKAD dicatat, alert', async () => {
  const h = harness({ wallet: 1000 }); h.deps.cfg = { ...CFG, betPct: 50 }; h.st.px = 83033; await runOnce(h.deps);
  h.st.px = 66400; h.liquidate(); await runOnce(h.deps);   // likuidasi #1, lalu #2 kebuka
  h.st.px = 53000; h.liquidate(); const r = await runOnce(h.deps);
  assert(r.rungkad, JSON.stringify(r)); assert(h.st.alerts.some((m) => /RUNGKAD/.test(m)));
  h.deps.cfg = CFG;
});

test('posisi hilang padahal harga jauh di atas liq -> tutup manual: siklus diakhiri + alert + jeda 24 jam (gak langsung buka)', async () => {
  const h = harness(); h.st.px = 83033; await runOnce(h.deps);
  h.st.px = 80000; h.st.qty = 0; const r = await runOnce(h.deps);
  assert(r.manual && h.j.cycle === null && r.manual.net > -20, JSON.stringify(r));
  const r2 = await runOnce(h.deps); assert(r2.idle && /jeda/.test(r2.idle) && h.st.orders.length === 1, JSON.stringify(r2));
  assert(h.st.alerts.some((m) => /Ditutup manual/.test(m)));
});

test('top up di tengah siklus -> modal per tangga ikut saldo terbaru (tangga berikutnya lebih gede)', async () => {
  const h = harness(); h.st.px = 83033; await runOnce(h.deps);
  h.st.wallet += 500; h.st.px = 80000; const r = await runOnce(h.deps);
  assert(r.idle === 'nunggu tangga' && Math.abs(h.j.cycle.unit - 120) < 1.5, `unit ${h.j.cycle.unit}`);
  h.st.px = 66000; const r2 = await runOnce(h.deps);
  assert(r2.bought && r2.bought.bet === 2 && r2.bought.mg > 110, JSON.stringify(r2)); // ~120 (dibulatin ke 0,0001 BTC), tanpa top up cuma 80
});

test('funding/fee kecil gak dianggap top up', async () => {
  const h = harness(); h.st.px = 83033; await runOnce(h.deps);
  h.st.wallet -= 1.5; await runOnce(h.deps);
  assert(Math.abs(h.j.cycle.unit - 80) < 0.01 && !(h.j.cycle.capChanges || []).length);
});

test('saldo lewat batas $1.000 -> grid pakai $1.000, Olan dikabarin lebihnya (sekali)', async () => {
  const h = harness({ wallet: 3000 }); h.deps.cfg = { ...CFG, maxCapUsd: 1000 }; h.st.px = 83033;
  const r = await runOnce(h.deps);
  assert(r.bought && Math.abs(r.bought.mg - 80) < 1, `margin ${r.bought && r.bought.mg}`);
  assert(h.st.alerts.filter((m) => /lewat batas modal grid/.test(m) && /\$2,000/.test(m)).length === 1, h.st.alerts.join(' | '));
  await runOnce(h.deps); assert(h.st.alerts.filter((m) => /lewat batas/.test(m)).length === 1);
});

test('cadangan bank: BingX $94 + bank $846 -> tangga 8% x $940; margin kurang -> DM top up, gak order; top up masuk -> tangga kebuka, cadangan berkurang', async () => {
  const h = harness({ wallet: 94 }); h.deps.cfg = { ...CFG, bankReserveUsd: 846, maxCapUsd: 1000 }; h.st.px = 83033;
  const r1 = await runOnce(h.deps);
  assert(r1.bought && Math.abs(r1.bought.mg - 75.2) < 1.5, `tangga #1 ${r1.bought && r1.bought.mg}`);
  h.st.px = 66000; const r2 = await runOnce(h.deps);
  assert(r2.idle === 'nunggu top up' && h.st.orders.length === 1, JSON.stringify(r2));
  assert(h.st.alerts.some((m) => /Top up minimal/.test(m)), h.st.alerts.join(' | '));
  h.st.wallet += 100; const r3 = await runOnce(h.deps);
  assert(r3.bought && r3.bought.bet === 2, JSON.stringify(r3));
  assert(Math.abs(h.j.bankReserve - 746) < 0.5, `cadangan ${h.j.bankReserve}`);
  assert(Math.abs(h.j.cycle.cycleCap - 940) < 3, `acuan ${h.j.cycle.cycleCap}`);
});

test('posisi nyasar di exchange tapi jurnal kosong -> STOP, gak order', async () => {
  const h = harness(); h.st.qty = 0.01; h.st.px = 83033; const r = await runOnce(h.deps);
  assert(r.stopped === 'stray' && h.st.orders.length === 0);
});

(async () => {
  let ok = 0, fail = 0;
  for (const [n, f] of tests) { try { await f(); ok++; console.log(`  OK   ${n}`); } catch (e) { fail++; console.log(`  GAGAL ${n}\n       ${e.message}`); } }
  console.log(`\n${ok} lolos, ${fail} gagal`); if (fail) process.exitCode = 1;
})();
