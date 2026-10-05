// Uji logika ninjaNewsTrader.js -- jam & exchange PALSU, gak ada order/WA asli. node ninjaNewsTrader.selftest.js
const assert = require('assert');
const { runDetector, decideSignal, updateTrail, eventTimeMs, freshJournal } = require('./ninjaNewsTrader');

const CFG = { enabled: true, allowReal: false, armBeforeSec: 120, preSec: 45, windowSec: 90, thrPct: 0.05, maxChasePct: 0.5, slPct: 0.4, trailActPct: 0.3, trailPct: 0.2, maxHoldMin: 20, recordMin: 15, targetTrades: 30 };

function harness({ eurPath, btcPath, busy = null }) {
  const T = Date.UTC(2026, 9, 14, 12, 30);
  const st = { t: T - 10000, pos: null, stops: {}, closed: 0, wa: [] };
  let oid = 1;
  const exec = {
    getAccountBalance: async () => 10000, setIsolatedMargin: async () => ({}), setLeverage: async () => ({}),
    placeMarketEntry: async ({ direction, notionalUsd, livePrice }) => { st.pos = { side: direction === 'buy' ? 'LONG' : 'SHORT' }; return { avgPrice: livePrice, executedQty: notionalUsd / livePrice }; },
    placeStopMarketClose: async ({ stopPrice }) => { const id = oid++; st.stops[id] = { stopPrice, status: 'NEW' }; return { orderId: id }; },
    cancelOrder: async (s, id) => { if (st.stops[id]) st.stops[id].status = 'CANCELED'; },
    getOrder: async (s, id) => st.stops[id] || null,
    getPositionBySide: async (s, side) => (st.pos && st.pos.side === side ? { positionAmt: '1' } : null),
    emergencyCloseMarket: async () => { st.pos = null; st.closed += 1; return { avgPrice: btcPath(Math.round((st.t - T) / 1000)) }; },
  };
  const j = freshJournal();
  const deps = {
    cfg: CFG, journal: j, event: { key: 'K', label: 'CPI TEST', timeMs: T },
    prices: async () => { const s = Math.round((st.t - T) / 1000); return { eur: eurPath(s), btc: btcPath(s) }; },
    sleep: async (ms) => { st.t += ms; },
    now: () => st.t,
    execFor: (testnet) => (testnet ? exec : null),
    strayCheck: async () => (st.pos ? 'unsafe' : 'clear'),
    busyReason: () => busy,
    notify: { sniperClub: async (m) => st.wa.push(m), wibowo: async (m) => st.wa.push(m) },
    kaelaJournal: { record: () => {}, update: () => {} },
    getIdrRate: async () => 16000,
    log: () => {},
  };
  return { T, st, j, deps };
}

const tests = [];
const test = (n, f) => tests.push([n, f]);

test('decideSignal: EUR naik >= ambang = LONG, turun = SHORT, kecil = null, BTC udah lari = skip', () => {
  assert.strictEqual(decideSignal({ eurBase: 1.1, eurNow: 1.1 * 1.0006, btcBase: 80000, btcNow: 80000 }, CFG), 'long');
  assert.strictEqual(decideSignal({ eurBase: 1.1, eurNow: 1.1 * 0.9994, btcBase: 80000, btcNow: 80000 }, CFG), 'short');
  assert.strictEqual(decideSignal({ eurBase: 1.1, eurNow: 1.1 * 1.0002, btcBase: 80000, btcNow: 80000 }, CFG), null);
  assert(decideSignal({ eurBase: 1.1, eurNow: 1.1 * 1.0006, btcBase: 80000, btcNow: 80500 }, CFG).skip);
});

test('updateTrail: aktif setelah +0,3%, jarak 0,2% dari terbaik, cuma maju', () => {
  const L = { entryPrice: 100, sl: 99.6, best: 100, trailed: false };
  assert.strictEqual(updateTrail(L, 'long', 100.2, CFG), false);
  assert.strictEqual(updateTrail(L, 'long', 100.5, CFG), true);
  assert(Math.abs(L.sl - 100.5 * 0.998) < 1e-9);
  const s = L.sl; updateTrail(L, 'long', 100.3, CFG); assert.strictEqual(L.sl, s);
});

test('eventTimeMs: 08:30 ET Oktober (EDT) = 12:30 UTC, November (EST) = 13:30 UTC', () => {
  assert.strictEqual(new Date(eventTimeMs('2026-10-14', '08:30')).toISOString(), '2026-10-14T12:30:00.000Z');
  assert.strictEqual(new Date(eventTimeMs('2026-11-10', '08:30')).toISOString(), '2026-11-10T13:30:00.000Z');
  assert.strictEqual(new Date(eventTimeMs('2026-10-28', '14:00')).toISOString(), '2026-10-28T18:00:00.000Z');
});

test('DXY turun (EUR naik) detik ke-3 -> BTC LONG, BTC nyusul naik lalu balik -> TRAIL untung, WA buka+tutup', async () => {
  const eur = (s) => (s < 3 ? 1.1 : 1.1 * 1.0008);
  const btc = (s) => (s < 5 ? 80000 : s < 60 ? 80000 + (s - 5) * 10 : Math.max(80000, 80550 - (s - 60) * 20));
  const h = harness({ eurPath: eur, btcPath: btc });
  const rec = await runDetector(h.deps);
  assert.strictEqual(rec.signal.dir, 'long');
  assert.strictEqual(rec.trade.demo.reason, 'NW_TRAIL');
  assert(rec.trade.demo.netUsd > 0, 'harus untung');
  assert.strictEqual(h.j.stats.demo.wins, 1);
  assert.strictEqual(h.j.floating, null);
  assert.strictEqual(h.st.wa.length, 6, 'buka+tutup (2 grup) + laporan rilis (2 grup)');
  const lap = h.st.wa[h.st.wa.length - 1];
  assert(/LAPORAN RILIS/.test(lap) && /Ninja News \(Demo\): LONG/.test(lap) && /realistis/.test(lap), lap);
  assert(rec.btc.m15 !== undefined, 'gerak menit ke-15 harus kerekam');
});

test('DXY naik (EUR turun) -> SHORT, BTC malah naik -> SL pendek 0,4%', async () => {
  const eur = (s) => (s < 2 ? 1.1 : 1.1 * 0.9993);
  const btc = (s) => 80000 + Math.max(0, s - 2) * 15;
  const h = harness({ eurPath: eur, btcPath: btc });
  const rec = await runDetector(h.deps);
  assert.strictEqual(rec.signal.dir, 'short');
  assert.strictEqual(rec.trade.demo.reason, 'NW_SL');
  assert(rec.trade.demo.netUsd < 0);
});

test('dolar diem -> gak entry, tetap kerekam buat riset', async () => {
  const h = harness({ eurPath: () => 1.1, btcPath: () => 80000 });
  const rec = await runDetector(h.deps);
  assert(rec.signal.none && !rec.trade);
  assert.strictEqual(h.st.closed, 0);
  // 5 Okt 2026 (permintaan Olan): laporan tetap dikirim walau gak open posisi
  assert.strictEqual(h.st.wa.length, 2, 'laporan rilis ke 2 grup walau gak entry');
  assert(/LAPORAN RILIS/.test(h.st.wa[0]) && /gak entry -- dolar adem/.test(h.st.wa[0]) && /\+0,000%/.test(h.st.wa[0]), h.st.wa[0]);
  assert(!/hawkish|dovish|NETRAL/i.test(h.st.wa[0]), 'laporan gak boleh nyimpulin hawkish/dovish (insiden 19 Sep)');
});

test('akun BingX lagi dipegang Ninja lain -> sinyal dicatat, gak entry', async () => {
  const h = harness({ eurPath: (s) => (s < 3 ? 1.1 : 1.1 * 1.0008), btcPath: () => 80000, busy: 'Ninja MR floating' });
  const rec = await runDetector(h.deps);
  assert.strictEqual(rec.signal.dir, 'long');
  assert.strictEqual(rec.trade.skipped, 'Ninja MR floating');
});

test('rilis mode rekam doang (trade:false) -> sinyal dicatat, gak buka posisi, laporan tetap keluar', async () => {
  const h = harness({ eurPath: (s) => (s < 3 ? 1.1 : 1.1 * 1.0015), btcPath: () => 80000 });
  h.deps.event = { ...h.deps.event, trade: false };
  const rec = await runDetector(h.deps);
  assert.strictEqual(rec.signal.dir, 'long');
  assert(/rekam doang/.test(rec.trade.skipped));
  assert.strictEqual(h.st.pos, null, 'gak boleh ada posisi');
  assert(h.st.wa.some((m) => /LAPORAN RILIS/.test(m) && /rekam doang/.test(m)));
});

// 5 Okt 2026 (arahan Olan "walau demo, yang realistis tetep siapkan"): net realistis + cek kesiapan real (baca doang)
test('net REALISTIS <= net demo & kecatat di riwayat; kesiapan real kebaca tanpa buka order real', async () => {
  const eur = (s) => (s < 3 ? 1.1 : 1.1 * 1.0008);
  const btc = (s) => (s < 5 ? 80000 : s < 60 ? 80000 + (s - 5) * 10 : Math.max(80000, 80550 - (s - 60) * 20));
  const h = harness({ eurPath: eur, btcPath: btc });
  h.deps.cfg = { ...CFG, realisticCostRtPct: 0.12 };
  const rec = await runDetector(h.deps);
  const hist = h.j.history[h.j.history.length - 1];
  assert(Number.isFinite(hist.netRealistic) && hist.netRealistic <= hist.net, 'net realistis wajib <= net demo');
  assert(hist.notionalUsd > 0);
  assert(/Nyopet volatilitas tinggi rilis berita CPI TEST: dolar melemah 0,08|Nyopet volatilitas tinggi rilis berita CPI TEST: dolar melemah 0\.08/.test(hist.reasonText), hist.reasonText);
  assert(h.st.wa.some((m) => /Alasan buka: Nyopet volatilitas tinggi/.test(m)), 'pesan WA buka wajib pakai alasan spesifik');
  assert.strictEqual(rec.realReady.ok, false, 'key real belum ada di harness');
  let realOrders = 0;
  const realExec = { getAccountBalance: async () => 100, placeMarketEntry: async () => { realOrders += 1; } };
  const h2 = harness({ eurPath: () => 1.1, btcPath: () => 80000 });
  const demoExec = h2.deps.execFor(true);
  h2.deps.execFor = (testnet) => (testnet ? demoExec : realExec);
  const rec2 = await runDetector(h2.deps);
  assert.strictEqual(rec2.realReady.ok, true, rec2.realReady.note);
  assert.strictEqual(rec2.realReady.balance, 100);
  assert.strictEqual(realOrders, 0, 'cek kesiapan gak boleh buka order real');
});

(async () => {
  let ok = 0, fail = 0;
  for (const [n, f] of tests) { try { await f(); ok++; console.log('  OK  ', n); } catch (e) { fail++; console.log('  GAGAL', n, '--', e.message); } }
  console.log(`\n${ok} lolos, ${fail} gagal`);
  if (fail) process.exit(1);
})();
