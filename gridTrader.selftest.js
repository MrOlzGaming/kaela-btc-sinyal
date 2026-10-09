// Uji logika gridTrader.js -- exchange & harga PALSU, gak ada order/WA asli. node gridTrader.selftest.js
const assert = require('assert');
const { runOnce, freshJournal } = require('./gridTrader');

const CFG = { enabled: true, allowReal: true, symbol: 'BTC-USDC', marginAsset: 'USDC', minDd: 15, step: 1, k: 1, tp: 15, volMult: [{ fromDd: 0, x: 1 }], capExposure: 2, leverage: 5 };

function harness({ wallet = 1000, ath = 100000, stray = 0 } = {}) {
  const st = { wallet, qty: stray, cost: 0, orders: [], wa: [], alerts: [], px: ath };
  const exec = {
    getPositionBySide: async () => (st.qty > 0 ? { positionAmt: String(st.qty) } : null),
    getWalletBalance: async () => st.wallet,
    setCrossMargin: async () => ({}), setLeverage: async () => ({}),
    getSymbolInfo: async () => ({ stepSize: 0.0001, quantityPrecision: 4, minNotionalUsd: 2 }),
    roundToStepSize: (q, s, p) => parseFloat((Math.floor(q / s + 1e-9) * s).toFixed(p)),
    placeMarketEntry: async ({ notionalUsd, livePrice }) => { const q = Math.floor(notionalUsd / livePrice / 0.0001 + 1e-9) * 0.0001; st.qty += q; st.cost += q * livePrice; st.orders.push({ side: 'buy', q, px: livePrice }); return { avgPrice: String(livePrice), executedQty: String(q) }; },
    emergencyCloseMarket: async ({ quantity }) => { const pnl = quantity * st.px - st.cost; st.wallet += pnl - (st.cost + quantity * st.px) * 0.0005; st.qty = 0; st.cost = 0; st.orders.push({ side: 'sell', q: quantity, px: st.px }); return { avgPrice: String(st.px) }; },
  };
  const j = freshJournal(); j.ath = ath;
  const deps = { cfg: CFG, journal: j, exec, now: () => 1791600000000, price: async () => st.px, athCandidate: async () => st.px, notify: async (m) => st.wa.push(m), alert: async (m) => st.alerts.push(m), log: () => {}, save: () => {} };
  return { st, j, deps };
}

const tests = []; const test = (n, f) => tests.push([n, f]);

test('BTC di ATH -10% (belum -15%) -> gak entry', async () => {
  const h = harness(); h.st.px = 90000;
  const r = await runOnce(h.deps);
  assert(r.idle && h.st.orders.length === 0);
});

test('mulai di ATH -34% -> langsung tanam 34% modal (1 order), pesan Buka Posisi GRID', async () => {
  const h = harness(); h.st.px = 66000;
  const r = await runOnce(h.deps);
  assert(r.bought && r.bought.opening);
  assert(Math.abs(h.j.cycle.planted - 340) < 7, `ditanam ${h.j.cycle.planted}`);
  assert.strictEqual(h.st.orders.length, 1);
  assert(/🕸️ GRID/.test(h.st.wa[0]) && /Buka Posisi/.test(h.st.wa[0]) && /ATH -34/.test(h.st.wa[0]) && /\(Real\)/.test(h.st.wa[0]), h.st.wa[0]);
});

test('turun 2 level lagi -> rebuy 2% modal, pesan Nambah Posisi', async () => {
  const h = harness(); h.st.px = 66000; await runOnce(h.deps);
  h.st.px = 64000; const r = await runOnce(h.deps);
  assert(r.bought && !r.bought.opening && r.bought.lvl === 36);
  assert(Math.abs(h.j.cycle.planted - 360) < 8, `ditanam ${h.j.cycle.planted}`);
  assert(/Nambah Posisi/.test(h.st.wa[1]) && /rebuy/.test(h.st.wa[1]));
});

test('harga naik sampai untung >= 15% modal ditanam -> tutup semua, catat riwayat, siklus baru pakai saldo baru (compound)', async () => {
  const h = harness(); h.st.px = 66000; await runOnce(h.deps);
  h.st.px = 66000 * 1.16; const r = await runOnce(h.deps);
  assert(r.tp && r.tp.retPlantedPct >= 15, JSON.stringify(r.tp));
  assert.strictEqual(h.j.cycle, null); assert.strictEqual(h.j.stats.cycles, 1);
  assert(/Tutup Posisi/.test(h.st.wa[1]) && /Target siklus kena/.test(h.st.wa[1]));
  // harga 76.560 = ATH -23% -> siklus baru langsung, modal grid = saldo baru (> 1000)
  const r2 = await runOnce(h.deps);
  assert(r2.bought && r2.bought.opening);
  assert(h.j.cycle.cycleCap > 1000, `modal siklus baru ${h.j.cycle.cycleCap}`);
});

test('ada posisi LONG di exchange tapi jurnal kosong -> STOP + peringatan, gak order', async () => {
  const h = harness({ stray: 0.01 }); h.st.px = 66000;
  const r = await runOnce(h.deps);
  assert.strictEqual(r.stopped, 'stray'); assert.strictEqual(h.st.orders.length, 0); assert(h.st.alerts.length === 1);
});

test('posisi grid hilang dari exchange -> siklus direset + peringatan', async () => {
  const h = harness(); h.st.px = 66000; await runOnce(h.deps);
  h.st.qty = 0; const r = await runOnce(h.deps);
  assert(r.gone && h.j.cycle === null && h.j.history[0].reason === 'GRID_GONE' && h.st.alerts.length === 1);
});

test('modal kecil: level di bawah minimum order ditumpuk ke level berikutnya', async () => {
  const h = harness({ wallet: 20 }); h.st.px = 66000; // 34% x $20 = $6,8 < 0,0001 BTC ($6,6)? -> 1 lot kebeli; rebuy 1% = $0,2 ditumpuk
  await runOnce(h.deps);
  h.st.px = 65000; const r = await runOnce(h.deps);
  assert(r.pending > 0, JSON.stringify(r)); assert(h.j.cycle.filledLvl === 35);
});

// 10 Okt 2026 (Olan: "kalo aku ada $95 langsung kebuka? sistem nyesuaiin modal, top up langsung buka lagi seolah modal udah ada")
test('modal $95 di ATH -34% -> langsung kebuka (~$32 ditanam)', async () => {
  const h = harness({ wallet: 95, ath: 126200 }); h.st.px = 82800;
  const r = await runOnce(h.deps);
  assert(r.bought && r.bought.opening, JSON.stringify(r));
  assert(h.j.cycle.planted > 20 && h.j.cycle.planted <= 32.4, `ditanam ${h.j.cycle.planted}`);
});

test('top up di tengah siklus -> modal grid naik, porsi dikejar SEKARANG (pesan Top up)', async () => {
  const h = harness({ wallet: 95, ath: 126200 }); h.st.px = 82800; await runOnce(h.deps);
  const before = h.j.cycle.planted;
  h.st.wallet += 400; // Olan setor $400
  const r = await runOnce(h.deps);
  assert(r.bought && r.bought.topUp, JSON.stringify(r));
  assert(Math.abs(h.j.cycle.cycleCap - 495) < 1, `modal ${h.j.cycle.cycleCap}`);
  assert(h.j.cycle.planted > before * 3, `ditanam ${before} -> ${h.j.cycle.planted}`);
  assert(/Top up modal grid kebaca/.test(h.st.wa[h.st.wa.length - 1]));
});

test('harga mantul naik (masih di bawah -15%) -> gak jual, gak nambah', async () => {
  const h = harness(); h.st.px = 66000; await runOnce(h.deps);
  const n = h.st.orders.length; h.st.px = 70000;
  const r = await runOnce(h.deps);
  assert(h.st.orders.length === n && !r.bought, JSON.stringify(r));
});

test('nyicil: setor $10 dulu (belum cukup min order) lalu top up $85 -> dihitung ulang, kebuka sebagai Buka Posisi pertama', async () => {
  const h = harness({ wallet: 10, ath: 126200 }); h.st.px = 82800;
  const r1 = await runOnce(h.deps);
  assert(r1.pending > 0 && h.st.orders.length === 0, JSON.stringify(r1));
  h.st.wallet += 85;
  const r2 = await runOnce(h.deps);
  assert(r2.bought && r2.bought.opening && r2.bought.topUp, JSON.stringify(r2));
  assert(Math.abs(h.j.cycle.cycleCap - 95) < 0.5);
  assert(/Buka Posisi/.test(h.st.wa[0]), h.st.wa[0]);
});

test('ATH baru kebaca -> acuan ATH naik', async () => {
  const h = harness(); h.st.px = 120000; await runOnce(h.deps);
  assert.strictEqual(h.j.ath, 120000);
});

(async () => {
  let ok = 0, fail = 0;
  for (const [n, f] of tests) { try { await f(); ok++; console.log('  OK  ', n); } catch (e) { fail++; console.log('  GAGAL', n, '--', e.message); } }
  console.log(`\n${ok} lolos, ${fail} gagal`); process.exit(fail ? 1 : 0);
})();
