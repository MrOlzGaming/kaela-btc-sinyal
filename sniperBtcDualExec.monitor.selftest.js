// Uji monitor Sniper dual: exchange, WA, & jurnal web PALSU; jurnal ditulis di folder sementara. node sniperBtcDualExec.monitor.selftest.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-uji-'));
for (const f of fs.readdirSync(__dirname)) if (/\.(js|json)$/.test(f) && f !== 'secrets.js') fs.copyFileSync(path.join(__dirname, f), path.join(tmp, f));
const stub = (name, exportsObj) => { const p = require.resolve(path.join(tmp, name)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; };
const wa = [], web = [];
stub('fonnte', { sendWhatsApp: async (m) => wa.push(m), sendWhatsAppToSniperClub: async (m) => wa.push(m), sendWhatsAppExcept: async () => {} });
stub('wibowoNotify', { sendWhatsAppToWibowo: async (m) => wa.push(m), WIBOWO_GROUP_ID: 'x' });
stub('kaelaJournalHook', { recordOpen: async () => {}, recordClose: async (id, pnl) => web.push([id, pnl]) });
const state = { qty: 0, fills: [] };
const be = require(path.join(tmp, 'binanceExecutor'));
be.loadSecrets = () => ({ BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' });
be.createBinanceClient = () => ({ getPositionRisk: async () => (state.qty ? { positionAmt: String(state.qty) } : null) });
global.fetch = async (url, opt) => {
  assert(!opt || !opt.method || opt.method === 'GET', 'monitor gak boleh kirim order di uji ini');
  const u = new URL(url);
  if (u.pathname.endsWith('/allOrders')) {
    const a = +u.searchParams.get('startTime'), b = +u.searchParams.get('endTime');
    return { json: async () => state.fills.filter((f) => f.updateTime >= a && f.updateTime <= b) };
  }
  return { json: async () => ({ price: '60000' }) };
};
const JP = path.join(tmp, 'sniper-btc-dual-exec-journal.json');
const OP = path.join(tmp, 'sniper-orders.json');
const hari = 86400e3, now = Date.now();
const leg = (qty, entry, sl, openedAt) => ({ trailR: 3, currentSl: sl, peak: entry, slNativeOk: true, entryPrice: entry, qty, leverage: 10, marginUsd: 100, openedAt: new Date(openedAt).toISOString() });
const order = (d) => ({ signalId: 'x', direction: 'buy', sl: 1, mode: 'sniper', wibowoRoute: 'demo', demo: d, real: null });
const fill = (qty, price, t) => ({ status: 'FILLED', reduceOnly: true, side: 'SELL', executedQty: String(qty), avgPrice: String(price), updateTime: t });
const tulis = (orders) => {
  fs.writeFileSync(JP, JSON.stringify({ orders, stats: { demo: { wins: 0, losses: 0, totalPnlUsd: 0 }, real: { wins: 0, losses: 0, totalPnlUsd: 0 } } }));
  fs.writeFileSync(OP, JSON.stringify({ orders: Object.keys(orders).map((id) => ({ id, status: 'floating', asset: 'btc' })) }));
};
const { monitorSniperBtcDual } = require(path.join(tmp, 'sniperBtcDualExec'));
const baca = () => JSON.parse(fs.readFileSync(JP, 'utf8'));

(async () => {
  // 1) dua tutupan lama: tiap order dapat harga fill-nya SENDIRI (lebih dari 7 hari lalu), statistik gak saling nimpa, tanpa WA
  tulis({ a: order(leg(0.0925, 80737.7, 77179.5, now - 30 * hari)), b: order(leg(0.0862, 80632.4, 75944.4, now - 22 * hari)) });
  state.fills = [fill(0.0925, 77065.8, now - 28 * hari), fill(0.0862, 75934.8, now - 21 * hari)];
  await monitorSniperBtcDual({ idrRate: null });
  let j = baca();
  assert.strictEqual(j.orders.a.demo.exitPrice, 77065.8); assert.strictEqual(j.orders.b.demo.exitPrice, 75934.8);
  assert.strictEqual(j.stats.demo.losses, 2); assert(Math.abs(j.stats.demo.totalPnlUsd - ((77065.8 - 80737.7) * 0.0925 + (75934.8 - 80632.4) * 0.0862)) < 0.01);
  assert(Date.parse(j.orders.a.demo.closedAt) === now - 28 * hari);
  assert.strictEqual(wa.length, 0); assert.strictEqual(web.length, 2);
  console.log('  OK   tutupan susulan: harga & waktu asli, statistik 2 rugi, tanpa WA');
  // 2) siklus berikutnya: catatan sniper-orders ikut ditutup, gak dihitung dobel
  await monitorSniperBtcDual({ idrRate: null });
  const o = JSON.parse(fs.readFileSync(OP, 'utf8')).orders;
  assert(o.every((x) => x.status === 'closed_live'), JSON.stringify(o)); assert.strictEqual(baca().stats.demo.losses, 2); assert.strictEqual(web.length, 2);
  console.log('  OK   sniper-orders ditutup, gak dobel');
  // 3) posisi kebaca kosong tanpa bukti fill: tunggu 2 siklus, siklus ke-3 baru pakai harga SL
  tulis({ c: order(leg(0.05, 70000, 66000, now - hari)) }); state.fills = [];
  await monitorSniperBtcDual({ idrRate: null }); await monitorSniperBtcDual({ idrRate: null });
  assert(!baca().orders.c.demo.closedAt);
  await monitorSniperBtcDual({ idrRate: null });
  assert.strictEqual(baca().orders.c.demo.exitPrice, 66000);
  console.log('  OK   tanpa bukti: gak langsung ditutup');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n3 lolos, 0 gagal');
  process.exit(0);
})().catch((e) => { console.log('  GAGAL', e.message); process.exit(1); });
