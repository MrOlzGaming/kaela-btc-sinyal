// Uji logika spotRealLeg.js pakai klien spot PALSU (gak ada order asli). node spotRealLeg.selftest.js
const assert = require('assert');
const { freshLedger, realBuys, realSells } = require('./spotRealLeg');

function fakeClient(bal) {
  const orders = [];
  return {
    orders,
    getSpotBalance: async (asset) => bal[asset] || 0,
    placeSpotMarketBuy: async ({ symbol, quoteOrderQty }) => { const px = 10; const q = quoteOrderQty / px; bal.USDT -= quoteOrderQty; const base = symbol.replace('USDT', ''); bal[base] = (bal[base] || 0) + q * 0.999; orders.push(['BUY', symbol, quoteOrderQty]); return { executedQty: q, cumulativeQuote: quoteOrderQty, avgPrice: px }; },
    placeSpotMarketSell: async ({ symbol, quantity }) => { const base = symbol.replace('USDT', ''); bal[base] -= quantity; orders.push(['SELL', symbol, quantity]); return { executedQty: quantity, cumulativeQuote: quantity * 12, avgPrice: 12 }; },
  };
}

const tests = [];
const test = (n, f) => tests.push([n, f]);

test('saldo USDT real 0 -> semua beli di-skip diam, gak ada order', async () => {
  const c = fakeClient({ USDT: 0 }); const L = freshLedger();
  const r = await realBuys(c, L, 'alt', { ETHUSDT: 10, SOLUSDT: 10 });
  assert.strictEqual(c.orders.length, 0); assert.strictEqual(r.executed, 0); assert.strictEqual(r.skippedLowBalance, 2);
});

test('saldo cukup sebagian -> beli yang muat, sisanya skip; ledger nyatet qty', async () => {
  const c = fakeClient({ USDT: 15 }); const L = freshLedger();
  const r = await realBuys(c, L, 'alt', { ETHUSDT: 10, SOLUSDT: 10 });
  assert.strictEqual(r.executed, 1); assert.strictEqual(r.skippedLowBalance, 1);
  assert.strictEqual(L.alt.ETHUSDT, 1);
});

test('anggaran khusus: saldo spot banyak tapi anggaran $12 -> cuma 1 beli $10, sisanya skip (setoran Olan aman)', async () => {
  const c = fakeClient({ USDT: 1000 }); const L = freshLedger();
  const r = await realBuys(c, L, 'alt', { ETHUSDT: 10, SOLUSDT: 10 }, new Date(), 12);
  assert.strictEqual(r.executed, 1); assert.strictEqual(L.spentUsd, 10);
  const r2 = await realBuys(c, L, 'alt', { BNBUSDT: 10 }, new Date(), 12);
  assert.strictEqual(r2.executed, 0, 'anggaran tinggal $2');
});

test('di bawah minimum $5 -> skip', async () => {
  const c = fakeClient({ USDT: 100 }); const L = freshLedger();
  await realBuys(c, L, 'alt', { DOGEUSDT: 3 });
  assert.strictEqual(c.orders.length, 0);
});

test('jual = yang tercatat, dibatasi saldo koin asli (fee beli dipotong dari koin), ledger jadi 0', async () => {
  const c = fakeClient({ USDT: 100 }); const L = freshLedger();
  await realBuys(c, L, 'alt', { ETHUSDT: 20 });
  const r = await realSells(c, L, 'alt', ['ETHUSDT', 'SOLUSDT']);
  assert.strictEqual(r.executed, 1);
  const sell = c.orders.find((o) => o[0] === 'SELL');
  assert(Math.abs(sell[2] - 2 * 0.999) < 1e-9, 'jual dibatasi saldo asli 1,998');
  assert.strictEqual(L.alt.ETHUSDT, 0);
});

test('koin Olan di luar ledger GAK ikut kejual', async () => {
  const c = fakeClient({ USDT: 0, ETH: 50 }); const L = freshLedger();
  const r = await realSells(c, L, 'alt', ['ETHUSDT']);
  assert.strictEqual(r.executed, 0); assert.strictEqual(c.orders.length, 0);
});

(async () => {
  let ok = 0, fail = 0;
  for (const [n, f] of tests) { try { await f(); ok++; console.log('  OK  ', n); } catch (e) { fail++; console.log('  GAGAL', n, '--', e.message); } }
  console.log(`\n${ok} lolos, ${fail} gagal`);
  if (fail) process.exit(1);
})();
