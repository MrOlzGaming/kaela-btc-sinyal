// Uji logika ninjaExhaustionTrader.js pakai exchange PALSU (gak ada order/WA asli). node ninjaExhaustionTrader.selftest.js
const assert = require('assert');
const { createTrader, freshJournal, updateEpisode } = require('./ninjaExhaustionTrader');

const CFG = { enabled: true, allowReal: false, entryEnabled: true, burstUsd: 800000, ratio: 0.3, slPct: 1, trailPct: 0.5, trailActPct: 1, maxHoldMin: 480, targetTrades: 100 };

function fakeExec(state) {
  let oid = 1;
  return {
    getAccountBalance: async () => 10000,
    setIsolatedMargin: async () => ({}),
    setLeverage: async () => ({}),
    placeMarketEntry: async ({ direction, notionalUsd, livePrice }) => { state.pos = { side: direction === 'buy' ? 'LONG' : 'SHORT', qty: +(notionalUsd / livePrice).toFixed(4) }; return { avgPrice: livePrice, executedQty: state.pos.qty }; },
    placeStopMarketClose: async ({ stopPrice }) => { const id = oid++; state.stops[id] = { stopPrice, status: 'NEW' }; return { orderId: id }; },
    cancelOrder: async (s, id) => { if (state.stops[id]) state.stops[id].status = 'CANCELED'; return {}; },
    getOrder: async (s, id) => (state.stops[id] ? { status: state.stops[id].status, avgPrice: state.stops[id].stopPrice, executedQty: state.stops[id].status === 'FILLED' ? 1 : 0 } : null),
    getPositionBySide: async (s, side) => (state.pos && state.pos.side === side ? { positionAmt: String(state.pos.qty), positionSide: side } : null),
    emergencyCloseMarket: async () => { state.pos = null; state.closedMarket += 1; return { avgPrice: state.price }; },
  };
}

function setup(over = {}) {
  const state = { price: 80000, pos: null, stops: {}, closedMarket: 0, wa: [], t: Date.UTC(2026, 9, 3, 10, 0), events: [] };
  const exec = fakeExec(state);
  const j = freshJournal();
  const trader = createTrader({
    cfg: { ...CFG, ...over }, journal: j,
    events: () => state.events,
    execFor: (testnet) => (testnet ? exec : null),
    fetchLivePrice: async () => state.price,
    strayCheck: async () => (state.pos ? 'unsafe' : 'clear'),
    otherNinjaBusy: () => !!state.busy,
    notify: { sniperClub: async (m) => state.wa.push(['club', m]), wibowo: async (m) => state.wa.push(['wibowo', m]) },
    kaelaJournal: { record: () => {}, update: () => {} },
    getIdrRate: async () => 16000,
    now: () => state.t,
    log: () => {},
  });
  return { state, j, trader };
}
const liq = (side, usd, t) => ({ symbol: 'BTCUSDT', side: side === 'long' ? 'BUY' : 'SELL', price: 80000, qty: usd / 80000, timestamp: t });
// bikin episode long-liq $1jt lalu "kering" -> sinyal LONG
async function triggerLongExhaustion(s) {
  s.state.events = [liq('long', 1000000, s.state.t)];
  await s.trader.runCycle();
  assert(s.j.episode && s.j.episode.side === 'long', 'episode long harusnya mulai');
  s.state.t += 60000; s.state.events = [liq('long', 200000, s.state.t)];
  await s.trader.runCycle();
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('updateEpisode: di bawah ambang gak mulai, kering <= 30% = exhausted', () => {
  assert.strictEqual(updateEpisode(null, { longUsd: 500000, shortUsd: 0 }, 0, CFG).ep, null);
  const a = updateEpisode(null, { longUsd: 900000, shortUsd: 0 }, 0, CFG);
  assert(a.ep && a.ep.side === 'long');
  const b = updateEpisode(a.ep, { longUsd: 400000, shortUsd: 0 }, 60000, CFG);
  assert(!b.exhausted && b.ep);
  const c = updateEpisode(b.ep, { longUsd: 250000, shortUsd: 0 }, 120000, CFG);
  assert.strictEqual(c.exhausted, 'long');
});

test('long-liq kering -> buka LONG demo + stop exchange 1% + WA 2 grup', async () => {
  const s = setup();
  await triggerLongExhaustion(s);
  const f = s.j.floating;
  assert(f && f.dir === 'long' && f.legs.demo && !f.legs.real);
  assert(Math.abs(f.legs.demo.sl - 79200) < 1e-6);
  assert(f.legs.demo.stopOrderId);
  assert.strictEqual(s.state.wa.length, 2);
});

test('trailing: untung +1% -> stop geser ke terbaik-0,5%, cuma maju; stop exchange kena = EX_TRAIL untung', async () => {
  const s = setup();
  await triggerLongExhaustion(s);
  s.state.events = [];
  s.state.t += 60000; s.state.price = 81000; await s.trader.runCycle();
  const L = s.j.floating.legs.demo;
  assert(L.trailed && Math.abs(L.sl - 81000 * 0.995) < 1e-6, 'stop harusnya 80595');
  const sl1 = L.sl;
  s.state.t += 60000; s.state.price = 80700; await s.trader.runCycle();
  assert.strictEqual(L.sl, sl1, 'stop gak boleh mundur');
  // exchange nembak stop
  s.state.stops[L.stopOrderId].status = 'FILLED'; s.state.pos = null;
  s.state.t += 60000; await s.trader.runCycle();
  assert.strictEqual(s.j.floating, null);
  assert.strictEqual(L.exitReason, 'EX_TRAIL');
  assert(L.netUsd > 0);
  assert.strictEqual(s.j.stats.demo.wins, 1);
  assert(s.state.wa.some(([, m]) => m.includes('1/100')), 'pesan tutup wajib ada progres uji 1/100');
});

test('backup software: harga tembus SL -> market close EX_SL rugi', async () => {
  const s = setup();
  await triggerLongExhaustion(s);
  s.state.events = [];
  s.state.t += 60000; s.state.price = 79100; await s.trader.runCycle();
  assert.strictEqual(s.j.floating, null);
  assert.strictEqual(s.state.closedMarket, 1);
  assert.strictEqual(s.j.stats.demo.losses, 1);
});

test('batas tahan 8 jam -> EX_TIME', async () => {
  const s = setup();
  await triggerLongExhaustion(s);
  s.state.events = [];
  s.state.t += 481 * 60000; s.state.price = 80100; await s.trader.runCycle();
  assert.strictEqual(s.j.floating, null);
  assert.strictEqual(s.state.closedMarket, 1);
});

test('short-liq kering -> SHORT, ukuran separuh long (kalkulator direction sell)', async () => {
  const a = setup(); await triggerLongExhaustion(a);
  const s = setup();
  s.state.events = [liq('short', 1000000, s.state.t)]; await s.trader.runCycle();
  s.state.t += 60000; s.state.events = [liq('short', 100000, s.state.t)]; await s.trader.runCycle();
  const f = s.j.floating;
  assert(f && f.dir === 'short' && Math.abs(f.legs.demo.sl - 80800) < 1e-6);
  assert(f.legs.demo.nilaiPosisi < a.j.floating.legs.demo.nilaiPosisi * 0.6, 'short harus ~separuh');
});

test('Ninja MR lagi sibuk -> sinyal di-skip, gak buka', async () => {
  const s = setup(); s.state.busy = true;
  await triggerLongExhaustion(s);
  assert.strictEqual(s.j.floating, null);
  assert.strictEqual(s.j.skipped, 1);
});

(async () => {
  let ok = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); ok++; console.log('  OK  ', name); } catch (e) { fail++; console.log('  GAGAL', name, '--', e.message); }
  }
  console.log(`\n${ok} lolos, ${fail} gagal`);
  if (fail) process.exit(1);
})();
