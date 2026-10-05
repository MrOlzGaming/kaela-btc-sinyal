// ninjaMrTrader.selftest.js (30 Sep 2026) -- uji alur penuh ninjaMrTrader.js pakai EXCHANGE PALSU
// (BingX asli gak bisa diakses dari sesi cloud). Pakai: node ninjaMrTrader.selftest.js
// Skenario: limit entry -> fill -> stop+limit exit terpasang -> exit via limit SMA20 (maker) / via
// software SL / via stop exchange / manual; real saldo kurang -> route demo; limit gak ke-fill ->
// lewat; candle yang nutup gak boleh buka; guard Ninja lama floating; fee exchange vs fallback.
const assert = require('assert');
const { createTrader, freshJournal, FALLBACK_FEE_PER_SIDE } = require('./ninjaMrTrader');
const { prepare, signal } = require('./backtestNinjaResearch3');

// ---------- data sintetis: random walk deterministik yang PUNYA sinyal ----------
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const TF = 15 * 60e3;
const candles = [];
let px = 60000;
for (let i = 0; i < 1500; i++) {
  const drift = Math.sin(i / 300) * 0.0008;
  const o = px, cl = px * (1 + drift + (rnd() - 0.5) * 0.01);
  candles.push({ openTime: i * TF, closeTime: i * TF + TF - 1, open: o, high: Math.max(o, cl) * (1 + rnd() * 0.003), low: Math.min(o, cl) * (1 - rnd() * 0.003), close: cl, volume: 1 });
  px = cl;
}
const ind = prepare(candles);
const P = { kind: 'mr', trend: true, k: 4, exit: 'mean' };
const sigIdx = [];
for (let i = 250; i < candles.length - 5; i++) if (signal(P, candles, ind, i)) sigIdx.push(i);
assert.ok(sigIdx.length >= 5, `data sintetis harus punya sinyal, dapet ${sigIdx.length}`);

// ---------- exchange palsu ----------
function fakeExchange({ balance = 5000, commission = null, rejectPostOnly = false } = {}) {
  const orders = new Map();
  let seq = 1;
  const positions = { LONG: 0, SHORT: 0 };
  const calls = [];
  const mk = (o) => { const id = String(seq++); orders.set(id, { orderId: id, status: 'NEW', executedQty: '0', avgPrice: '0', commission: commission === null ? undefined : String(-commission), ...o }); return orders.get(id); };
  const ex = {
    calls, orders, positions,
    async getAccountBalance() { return balance; },
    async getSymbolInfo() { return { stepSize: 0.0001, quantityPrecision: 4, pricePrecision: 1, minNotionalUsd: 2 }; },
    async setIsolatedMargin() { calls.push('isolated'); },
    async setLeverage(s, lev, side) { calls.push(`lev:${lev}:${side}`); },
    async placeLimitEntry({ direction, quantity, price }) { if (rejectPostOnly) throw new Error('PostOnly order would take'); calls.push('limitEntry'); return mk({ type: 'LIMIT', kind: 'entry', direction, quantity, price, positionSide: direction === 'buy' ? 'LONG' : 'SHORT' }); },
    async placeStopMarketClose({ direction, quantity, stopPrice }) { calls.push('stop'); return mk({ type: 'STOP_MARKET', kind: 'stop', direction, quantity, stopPrice }); },
    async placeLimitClose({ direction, quantity, price }) { calls.push('limitClose'); return mk({ type: 'LIMIT', kind: 'exit', direction, quantity, price }); },
    failGetOrder: false,
    async getOrder(s, id) { if (ex.failGetOrder) throw new Error('timeout'); return orders.get(String(id)) || null; },
    async cancelOrder(s, id) { const o = orders.get(String(id)); if (o && o.status === 'NEW') o.status = 'CANCELED'; calls.push('cancel'); return {}; },
    async getPositionBySide(s, side) { return positions[side] > 0 ? { positionSide: side, positionAmt: String(positions[side]) } : null; },
    async emergencyCloseMarket({ direction, quantity }) { calls.push('marketClose'); const side = direction === 'buy' ? 'LONG' : 'SHORT'; positions[side] = Math.max(0, positions[side] - quantity); return { order: { avgPrice: String(ex.live), executedQty: String(quantity), commission: commission === null ? undefined : String(-commission) } }; },
    live: 0,
    // helper uji: isi order entry -> posisi kebuka
    fill(orderId, price) { const o = orders.get(String(orderId)); o.status = 'FILLED'; o.executedQty = String(o.quantity); o.avgPrice = String(price); positions[o.positionSide] += o.quantity; },
    // helper uji: exit/stop kena di exchange -> posisi hilang
    fillClose(orderId, price) { const o = orders.get(String(orderId)); o.status = 'FILLED'; o.executedQty = String(o.quantity); o.avgPrice = String(price); const side = o.direction === 'buy' ? 'LONG' : 'SHORT'; positions[side] = 0; },
  };
  return ex;
}

function harness({ demo, real, allowReal = true, oldFloating = false, cfgExtra = {}, data = candles }) {
  const journal = freshJournal();
  const sent = { sc: [], wb: [] };
  const skipped = [];
  const kj = { rec: [], upd: [] };
  let t = 0;
  const trader = createTrader({
    cfg: { enabled: true, allowReal, tf: '15m', k: 4, ...cfgExtra }, journal,
    execFor: (testnet) => (testnet ? demo : real),
    fetchLivePrice: async (testnet) => (testnet ? demo : real).live,
    strayCheck: async () => 'clear', oldNinjaFloating: () => oldFloating,
    notify: { sniperClub: async (m) => sent.sc.push(m), wibowo: async (m) => sent.wb.push(m) },
    recordSkipped: (x) => skipped.push(x),
    kaelaJournal: { record: (m, e) => kj.rec.push([m, e]), update: (id, p) => kj.upd.push([id, p]) },
    getIdrRate: async () => 16000,
    now: () => t, log: () => {},
  });
  // jalanin siklus di "menit" ke-m setelah candle idx close (0 = pas close)
  const cycle = async (idx, minute = 0) => { t = data[idx].closeTime + 1 + minute * 60e3; await trader.runCycle(data.slice(0, idx + 1)); };
  return { journal, sent, skipped, kj, cycle, trader };
}

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log(`  OK   ${name}`); } catch (e) { failed++; console.log(`  GAGAL ${name}\n       ${e.message}`); } }

(async () => {
  const s0 = sigIdx[0];
  const dir0 = signal(P, candles, ind, s0);

  await test('sinyal -> limit post-only demo+real dipasang, pending berlaku sampai candle berikutnya', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); // warmup: lastProcessed keisi
    await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    assert.ok(pe && pe.dir === dir0, 'pending harus ada searah sinyal');
    assert.ok(pe.legs.demo && pe.legs.real, 'dua leg dipasang');
    assert.ok(demo.calls.includes('limitEntry') && real.calls.includes('limitEntry'));
    const c = candles[s0].close;
    assert.ok(dir0 === 'long' ? pe.limitPrice < c : pe.limitPrice > c, 'limit 1 tick di sisi baik close');
    assert.strictEqual(pe.expiresAtCloseTime, candles[s0].closeTime + TF);
    assert.strictEqual(h.sent.sc.length + h.sent.wb.length, 0, 'belum ada WA sebelum fill');
  });

  // 5 Okt 2026: harga BingX (venue) beda dari Binance spot (sumber sinyal) -- demo diukur -$36,5. Limit dari close spot bikin
  // post-only BUY nyeberang -> ditolak BingX (101215) -> MR nol trade sejak 30 Sep. Limit & target exit WAJIB skala harga venue.
  await test('harga venue beda dari spot (-$36,5): limit 1 tick dari harga VENUE (gak nyeberang), target exit SMA20 ikut digeser', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1);
    const c = candles[s0].close, venue = c - 36.5;
    demo.live = real.live = venue;
    await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    for (const L of [pe.legs.demo, pe.legs.real]) {
      assert.ok(dir0 === 'long' ? L.limitPrice < venue : L.limitPrice > venue, `limit ${L.limitPrice} harus di sisi baik harga venue ${venue} (bukan close spot ${c})`);
      assert.ok(Math.abs(L.limitPrice - venue) / venue < 1e-4, 'limit nempel harga venue (1 tick)');
    }
    demo.fill(pe.legs.demo.orderId, pe.legs.demo.limitPrice); real.fill(pe.legs.real.orderId, pe.legs.real.limitPrice);
    demo.live = real.live = pe.legs.demo.limitPrice;
    await h.cycle(s0, 1);
    const L = h.journal.floating.legs.demo;
    const expected = ind.sma20[s0] * pe.legs.demo.limitPrice / c;
    assert.ok(Math.abs(L.exitLimitPrice - expected) / expected < 1e-9, `target exit ${L.exitLimitPrice} harus SMA20 x rasio venue/spot (${expected})`);
    assert.ok(Math.abs(L.exitLimitPrice - ind.sma20[s0]) / ind.sma20[s0] > 0.0003, 'target exit beneran kegeser dari SMA20 spot');
  });

  await test('fill demo+real -> floating, stop exchange + limit exit SMA20 terpasang, WA buka: SC demo, Wibowo REAL', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); real.fill(pe.legs.real.orderId, pe.limitPrice);
    demo.live = real.live = pe.limitPrice;
    await h.cycle(s0, 1);
    const f = h.journal.floating;
    assert.ok(f && f.legs.demo && f.legs.real, 'floating dua leg');
    assert.strictEqual(h.journal.pendingEntry, null);
    assert.strictEqual(f.wibowoRoute, 'real');
    assert.ok(demo.calls.includes('stop') && demo.calls.includes('limitClose'), 'stop + limit exit demo');
    assert.ok(f.legs.demo.stopOrderId && f.legs.demo.exitOrderId);
    const sl = f.legs.demo.sl, e = f.legs.demo.entryPrice;
    assert.ok(Math.abs(Math.abs(sl - e) / e * 100 - f.slDistPct) < 1e-9, 'SL = k x ATR dari harga fill');
    assert.strictEqual(h.sent.sc.length, 1); assert.strictEqual(h.sent.wb.length, 1);
    assert.ok(h.sent.sc[0].includes('(Demo)') && !h.sent.wb[0].includes('(Demo)'), 'SC demo, Wibowo real');
    assert.ok(h.sent.wb[0].includes('TP:') && h.sent.wb[0].includes('SMA20') && !h.sent.wb[0].includes('TP1'), 'baris TP target penuh');
    assert.ok(h.sent.wb[0].includes('Mean Reversion'), 'alasan buka');
    assert.strictEqual(h.kj.rec.length, 2, 'Journal.gs 2 entry');
  });

  await test('exit via limit SMA20 kena di exchange (maker) -> tutup MR_MEAN, fee dari commission exchange, stats & WA tutup', async () => {
    const demo = fakeExchange({ commission: 0.011 }), real = fakeExchange({ balance: 14, commission: 0.002 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); real.fill(pe.legs.real.orderId, pe.limitPrice);
    demo.live = real.live = pe.limitPrice; await h.cycle(s0, 1);
    const f = h.journal.floating;
    const exitPx = f.legs.demo.exitLimitPrice;
    demo.fillClose(f.legs.demo.exitOrderId, exitPx); real.fillClose(f.legs.real.exitOrderId, exitPx);
    await h.cycle(s0, 2);
    assert.strictEqual(h.journal.floating, null, 'floating selesai');
    assert.strictEqual(h.journal.closedCount, 1);
    const st = h.journal.stats.demo;
    assert.strictEqual(st.wins + st.losses, 1);
    assert.strictEqual(h.sent.sc.length, 2); assert.strictEqual(h.sent.wb.length, 2);
    assert.ok(h.sent.wb[1].includes('Tutup Posisi') && h.sent.wb[1].includes('rata-rata SMA20') && h.sent.wb[1].includes('Win rate Mean Reversion (Real): '), 'WA tutup real ke Wibowo');
    assert.ok(h.sent.sc[1].includes('Fee (round-trip)'), 'fee tampil');
    assert.ok(h.kj.upd.length === 2 && h.kj.upd[0][1].status === 'closed');
  });

  await test('fee: commission exchange dipakai kalau ada, fallback 0,05%/sisi kalau gak kebaca', async () => {
    const demo = fakeExchange({ commission: 0.011 }), real = fakeExchange({ balance: 14 }); // real: commission undefined
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); real.fill(pe.legs.real.orderId, pe.limitPrice);
    demo.live = real.live = pe.limitPrice; await h.cycle(s0, 1);
    const f = h.journal.floating; const legD = f.legs.demo, legR = f.legs.real;
    demo.fillClose(legD.exitOrderId, legD.exitLimitPrice); real.fillClose(legR.exitOrderId, legR.exitLimitPrice);
    await h.cycle(s0, 2);
    assert.strictEqual(legD.feeSource, 'exchange'); assert.ok(Math.abs(legD.feeUsd - 0.022) < 1e-9);
    assert.strictEqual(legR.feeSource, 'fallback');
    const expected = (legR.entryPrice + legR.exitPrice) * legR.quantity * FALLBACK_FEE_PER_SIDE / 100;
    assert.ok(Math.abs(legR.feeUsd - expected) < 1e-9, 'fallback = 0,05% x notional tiap sisi');
    assert.ok(Math.abs(legR.netUsd - (legR.grossUsd - legR.feeUsd)) < 1e-9);
  });

  await test('software SL: harga live nembus SL, posisi masih ada -> tutup market MR_SL, order sisa dibatalin', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); real.fill(pe.legs.real.orderId, pe.limitPrice);
    demo.live = real.live = pe.limitPrice; await h.cycle(s0, 1);
    const f = h.journal.floating; const sl = f.legs.demo.sl;
    demo.live = real.live = f.dir === 'long' ? sl * 0.999 : sl * 1.001;
    await h.cycle(s0, 3);
    assert.strictEqual(h.journal.floating, null);
    assert.ok(demo.calls.includes('marketClose') && real.calls.includes('marketClose'));
    assert.ok(h.sent.wb[1].includes('Stop Loss kena'), 'alasan SL');
    assert.strictEqual(h.journal.stats.real.losses, 1);
  });

  await test('stop exchange kena (posisi hilang, order stop FILLED) -> MR_SL dgn harga fill stop', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); real.fill(pe.legs.real.orderId, pe.limitPrice);
    demo.live = real.live = pe.limitPrice; await h.cycle(s0, 1);
    const f = h.journal.floating;
    demo.fillClose(f.legs.demo.stopOrderId, f.legs.demo.sl); real.fillClose(f.legs.real.stopOrderId, f.legs.real.sl);
    await h.cycle(s0, 2);
    assert.strictEqual(h.journal.floating, null);
    assert.ok(h.sent.sc[1].includes('Stop Loss kena'));
  });

  await test('posisi hilang tanpa order kita yang FILLED (manual) -> MR_MANUAL, harga live', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); real.fill(pe.legs.real.orderId, pe.limitPrice);
    demo.live = real.live = pe.limitPrice; await h.cycle(s0, 1);
    demo.positions.LONG = demo.positions.SHORT = 0; real.positions.LONG = real.positions.SHORT = 0;
    await h.cycle(s0, 2);
    assert.strictEqual(h.journal.floating, null);
    assert.ok(h.sent.wb[1].includes('di luar sistem'));
  });

  await test('real saldo kurang -> real skip + dicatat rekap, Wibowo dapet notif DEMO pengganti', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 0.5 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    assert.ok(pe.legs.demo && !pe.legs.real, 'real gak dipasang');
    assert.strictEqual(h.skipped.length, 1);
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); demo.live = pe.limitPrice; await h.cycle(s0, 1);
    assert.strictEqual(h.journal.floating.wibowoRoute, 'demo');
    assert.strictEqual(h.sent.wb.length, 1); assert.ok(h.sent.wb[0].includes('(Demo)'), 'Wibowo dapet demo');
    assert.ok(!h.sent.wb[0].includes('saldo'), 'silent -- gak ekspos alasan saldo');
  });

  await test('allowReal:false -> cuma demo, Wibowo dapet demo', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 5000 });
    const h = harness({ demo, real, allowReal: false });
    await h.cycle(s0 - 1); await h.cycle(s0);
    assert.ok(!h.journal.pendingEntry.legs.real && !real.calls.includes('limitEntry'));
  });

  await test('limit gak ke-fill sampai candle berikutnya close -> dibatalin, sinyal LEWAT, gak ada posisi', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0);
    for (let m = 1; m < 15; m++) await h.cycle(s0, m);
    assert.ok(h.journal.pendingEntry, 'masih nunggu selama candle belum close');
    await h.cycle(s0 + 1);
    assert.strictEqual(h.journal.pendingEntry, null);
    assert.strictEqual(h.journal.floating, null);
    assert.strictEqual(h.journal.missedEntries, 1);
    assert.ok(demo.calls.includes('cancel'));
  });

  await test('candle basi (> 3 menit setelah close) -> gak pasang limit di harga lama', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0, 10);
    assert.strictEqual(h.journal.pendingEntry, null);
  });

  await test('guard: Ninja lama masih floating di akun yang sama -> gak entry', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real, oldFloating: true });
    await h.cycle(s0 - 1); await h.cycle(s0);
    assert.strictEqual(h.journal.pendingEntry, null);
  });

  await test('post-only ditolak exchange (bakal langsung match) -> skip aman, gak ada posisi', async () => {
    const demo = fakeExchange({ rejectPostOnly: true }), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0);
    assert.strictEqual(h.journal.pendingEntry, null);
    assert.ok(!real.calls.includes('limitEntry'), 'demo gagal -> real gak dicoba');
  });

  await test('candle close nembus SMA20 tapi limit exit belum kena -> tutup market MR_MEAN; candle yang nutup gak buka posisi baru', async () => {
    // cari sinyal yang candle berikutnya udah balik nembus SMA20 (mean hit di candle entry+1)
    let picked = null;
    for (const s of sigIdx) { const d = signal(P, candles, ind, s); const n = s + 1; if (ind.sma20[n] !== null && (d === 'long' ? candles[n].close >= ind.sma20[n] : candles[n].close <= ind.sma20[n])) { picked = s; break; } }
    if (picked === null) { console.log('       (skip: data sintetis gak punya kasus ini)'); return; }
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(picked - 1); await h.cycle(picked);
    const pe = h.journal.pendingEntry;
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); real.fill(pe.legs.real.orderId, pe.limitPrice);
    demo.live = real.live = pe.limitPrice; await h.cycle(picked, 1);
    const f = h.journal.floating;
    demo.live = real.live = f.dir === 'long' ? f.legs.demo.entryPrice * 1.001 : f.legs.demo.entryPrice * 0.999; // belum kena SL
    await h.cycle(picked + 1);
    assert.strictEqual(h.journal.floating, null, 'ditutup pas candle close nembus SMA20');
    assert.ok(demo.calls.includes('marketClose'));
    assert.strictEqual(h.journal.pendingEntry, null, 'candle yang nutup gak boleh buka posisi baru');
  });

  await test('limit exit SMA20 digeser tiap candle baru (cancel + pasang ulang) selama posisi terbuka', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); demo.live = pe.limitPrice; real.fill(pe.legs.real.orderId, pe.limitPrice); real.live = pe.limitPrice;
    await h.cycle(s0, 1);
    const f = h.journal.floating; const before = f.legs.demo.exitOrderId; const nClose = demo.calls.filter((c) => c === 'limitClose').length;
    // candle berikutnya: harga tetap jauh dari SL & belum nembus SMA20 -> hanya geser limit
    const n = s0 + 1; const meanHit = f.dir === 'long' ? candles[n].close >= ind.sma20[n] : candles[n].close <= ind.sma20[n];
    if (meanHit) { console.log('       (skip: candle berikutnya langsung mean-hit di data ini)'); return; }
    demo.live = real.live = f.legs.demo.entryPrice; await h.cycle(n);
    assert.ok(h.journal.floating, 'masih floating');
    if (Math.abs(ind.sma20[n] - f.legs.demo.exitLimitPrice) / f.legs.demo.exitLimitPrice * 100 >= 0.01) assert.ok(f.legs.demo.exitOrderId !== before && demo.calls.filter((c) => c === 'limitClose').length > nClose, 'limit exit digeser');
  });

  await test('real fill BELAKANGAN dari demo -> tetap diproses, Wibowo nunggu lalu dapet notif REAL', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real });
    await h.cycle(s0 - 1); await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); demo.live = real.live = pe.limitPrice;
    await h.cycle(s0, 1);
    assert.ok(h.journal.floating && h.journal.floating.legs.demo && !h.journal.floating.legs.real, 'demo dulu');
    assert.ok(h.journal.pendingEntry, 'pending real masih dipantau');
    assert.strictEqual(h.sent.sc.length, 1); assert.strictEqual(h.sent.wb.length, 0, 'Wibowo NUNGGU keputusan real');
    real.fill(pe.legs.real.orderId, pe.limitPrice);
    await h.cycle(s0, 2);
    assert.ok(h.journal.floating.legs.real, 'real ikut masuk floating');
    assert.strictEqual(h.journal.pendingEntry, null);
    assert.strictEqual(h.journal.floating.wibowoRoute, 'real');
    assert.strictEqual(h.sent.wb.length, 1); assert.ok(!h.sent.wb[0].includes('(Demo)'), 'Wibowo dapet REAL');
  });

  await test('expiry tapi getOrder GAGAL: verifikasi lewat posisi -- posisi ada -> dianggap fill, bukan ditinggal yatim', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real, allowReal: false });
    await h.cycle(s0 - 1); await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); // fill terjadi, tapi API order-nya lagi error
    demo.failGetOrder = true; demo.live = pe.limitPrice;
    await h.cycle(s0 + 1); // expiry
    assert.ok(h.journal.floating && h.journal.floating.legs.demo, 'posisi kedeteksi lewat user/positions');
    assert.strictEqual(h.journal.missedEntries, 0);
  });

  await test('expiry, getOrder gagal DAN positions gagal -> pending DIPERTAHANKAN (coba lagi), gak resolve nebak', async () => {
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real, allowReal: false });
    await h.cycle(s0 - 1); await h.cycle(s0);
    demo.failGetOrder = true; const origPos = demo.getPositionBySide; demo.getPositionBySide = async () => { throw new Error('timeout'); };
    await h.cycle(s0 + 1);
    assert.ok(h.journal.pendingEntry, 'masih pending');
    demo.failGetOrder = false; demo.getPositionBySide = origPos;
    await h.cycle(s0 + 1, 1);
    assert.strictEqual(h.journal.pendingEntry, null); assert.strictEqual(h.journal.missedEntries, 1);
  });

  await test('(data dimodifikasi) candle setelah fill close nembus SMA20 -> tutup market MR_MEAN, candle itu gak buka posisi baru', async () => {
    const data = candles.map((c) => ({ ...c }));
    const n = s0 + 1; const d = dir0; const sma = ind.sma20[n];
    // paksa close candle n nembus SMA20 searah target, tanpa nyentuh SL (SL 4x ATR jauh)
    const target = d === 'long' ? sma * 1.0005 : sma * 0.9995;
    data[n].close = target; data[n].high = Math.max(data[n].high, target); data[n].low = Math.min(data[n].low, target);
    const ind2 = prepare(data.slice(0, n + 1));
    const meanHit = d === 'long' ? data[n].close >= ind2.sma20[n] : data[n].close <= ind2.sma20[n];
    assert.ok(meanHit, 'setup: candle n harus nembus SMA20');
    const demo = fakeExchange(), real = fakeExchange({ balance: 14 });
    const h = harness({ demo, real, data });
    await h.cycle(s0 - 1); await h.cycle(s0);
    const pe = h.journal.pendingEntry;
    demo.fill(pe.legs.demo.orderId, pe.limitPrice); real.fill(pe.legs.real.orderId, pe.limitPrice);
    demo.live = real.live = pe.limitPrice; await h.cycle(s0, 1);
    demo.live = real.live = target; // limit exit (di SMA20 lama) belum kena di exchange palsu
    await h.cycle(n);
    assert.strictEqual(h.journal.floating, null, 'ditutup market pas close nembus SMA20');
    assert.ok(demo.calls.includes('marketClose'));
    assert.ok(h.sent.wb[1].includes('rata-rata SMA20'));
    assert.strictEqual(h.journal.pendingEntry, null, 'candle yang nutup gak buka posisi baru');
  });

  console.log(`\n${passed} lolos, ${failed} gagal`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR selftest:', e.stack); process.exit(1); });
