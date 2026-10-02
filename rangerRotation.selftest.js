// rangerRotation.selftest.js (3 Okt 2026) -- alur penuh Ranger Rotasi dgn exchange PALSU (gak ada network/WA/order asli).
const assert = require('assert');
const { createRotation, freshJournal } = require('./rangerRotation');

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  OK  ', name); } catch (e) { failed++; console.log('  GAGAL', name, '\n   ', e.message); } }

function fakeExchange() {
  const positions = {}; // key `${symbol}|${side}` -> {positionAmt}
  const orders = [];
  return {
    positions, orders,
    async getSymbolInfo() { return { stepSize: 0.001, quantityPrecision: 3 }; },
    roundToStepSize(q, step, prec) { return Number((Math.floor(q / step) * step).toFixed(prec)); },
    async getPositionRisk(symbol) { const k = Object.keys(positions).find((x) => x.startsWith(symbol + '|') && positions[x].positionAmt > 0); return k ? positions[k] : null; },
    async getPositionBySide(symbol, side) { const p = positions[`${symbol}|${side}`]; return p && p.positionAmt > 0 ? p : null; },
    async getAccountBalance() { return 100000; },
    async setIsolatedMargin() {}, async setLeverage() {},
    async placeMarketEntry({ symbol, direction, notionalUsd, livePrice }) {
      const qty = Number((notionalUsd / livePrice).toFixed(3));
      const side = direction === 'buy' ? 'LONG' : 'SHORT';
      positions[`${symbol}|${side}`] = { positionAmt: qty, positionSide: side };
      orders.push({ type: 'open', symbol, direction, qty });
      return { avgPrice: String(livePrice), executedQty: String(qty) };
    },
    async emergencyCloseMarket({ symbol, direction, quantity }) {
      const k = `${symbol}|${direction === 'buy' ? 'LONG' : 'SHORT'}`;
      positions[k].positionAmt = Number((positions[k].positionAmt - quantity).toFixed(3));
      orders.push({ type: 'close', symbol, quantity });
      return { order: { avgPrice: String(this._px) } };
    },
  };
}

function setup({ signals = {}, bear = false, prices = {}, closeTime } = {}) {
  const ex = fakeExchange();
  const j = freshJournal();
  const sent = [];
  let clock = Date.UTC(2026, 9, 3, 12, 5);
  const candleClose = closeTime || Date.UTC(2026, 9, 3, 12, 0) - 1;
  const st = { prices: { BTC: 100, SOL: 50, DOGE: 0.1, TRX: 0.3, INJ: 7, ETH: 2600, XLM: 0.2, BNB: 700, ...prices }, trail: null, bear };
  const deps = {
    cfg: { enabled: true, coins: ['BTC', 'SOL', 'DOGE', 'TRX', 'INJ', 'ETH', 'XLM', 'BNB'], dxyFilter: false },
    journal: j, exec: ex,
    fetchCandles: async (coin, n) => {
      if (n < 100) return Array.from({ length: 65 }, () => ({ close: st.trail === null ? st.prices[coin] : st.trail, closeTime: candleClose }));
      return Array.from({ length: 400 }, () => ({ close: st.prices[coin], closeTime: candleClose }));
    },
    fetchPrice: async (coin) => { ex._px = st.prices[coin]; return st.prices[coin]; },
    notify: async (m) => { sent.push(m); },
    now: () => clock, isBear: () => st.bear, dxyWeak: async () => true, log: () => {},
    signalFn: (c, bearNow, coin) => signals[coin] || null,
    fmt: { open: (f) => `OPEN ${f.coin}`, partial: (f) => `PARTIAL ${f.coin}`, closed: (f, px, tot, r) => `CLOSED ${f.coin} ${r} ${tot === null ? 'null' : tot.toFixed(2)}`, untracked: (f) => `UNTRACKED ${f.coin}` },
  };
  const rot = createRotation(deps);
  return { ex, j, sent, rot, st, deps, setClock: (v) => { clock = v; } };
}

(async () => {
  await t('scan: koin prioritas tertinggi yang ada sinyal dibuka, cuma 1 posisi', async () => {
    const { ex, j, sent, rot } = setup({ signals: { DOGE: { direction: 'buy', sl: 0.09, patternType: 'fvg_bounce' }, ETH: { direction: 'buy', sl: 2500, patternType: 'flag_bull' } } });
    await rot.runCycle();
    assert.strictEqual(j.floating.coin, 'DOGE');
    assert.strictEqual(ex.orders.filter((o) => o.type === 'open').length, 1);
    assert.deepStrictEqual(sent, ['OPEN DOGE']);
    assert.ok(Math.abs(j.floating.partialTp - 0.12) < 1e-9, `TP1 2R salah: ${j.floating.partialTp}`);
  });
  await t('koin yang udah ada posisi lain (Ninja/manual) dilewati, pindah ke koin berikutnya; posisi lain GAK disentuh', async () => {
    const { ex, j, rot } = setup({ signals: { BTC: { direction: 'buy', sl: 95, patternType: 'flag_bull' }, SOL: { direction: 'buy', sl: 45, patternType: 'fvg_bounce' } } });
    ex.positions['BTC-USDT|SHORT'] = { positionAmt: 0.5, positionSide: 'SHORT' };
    await rot.runCycle();
    assert.strictEqual(j.floating.coin, 'SOL');
    assert.strictEqual(ex.positions['BTC-USDT|SHORT'].positionAmt, 0.5);
  });
  await t('candle 4H yang sama gak discan ulang; candle basi (>1 jam) gak entry', async () => {
    const s = setup({ signals: { BTC: { direction: 'buy', sl: 95, patternType: 'flag_bull' } }, closeTime: Date.UTC(2026, 9, 3, 8, 0) - 1 });
    await s.rot.runCycle();
    assert.strictEqual(s.j.floating, null, 'candle basi harusnya gak entry');
    await s.rot.runCycle();
    assert.strictEqual(s.ex.orders.length, 0);
  });
  await t('long: 2R -> tutup separuh & SL ke entry -> trailing patah -> tutup sisa, stats & history kecatat', async () => {
    const s = setup({ signals: { BTC: { direction: 'buy', sl: 90, patternType: 'flag_bull' } } });
    await s.rot.runCycle();
    const qty = s.j.floating.qty;
    s.st.prices.BTC = 121; s.st.trail = 110; // lewat 2R (120)
    await s.rot.runCycle();
    assert.ok(s.j.floating.partialDone && s.j.floating.sl === 100);
    assert.ok(Math.abs(s.ex.positions['BTC-USDT|LONG'].positionAmt - (qty - Math.floor(qty * 0.5 / 0.001) * 0.001)) < 1e-6);
    s.st.prices.BTC = 108; // di atas entry, di bawah trailing SMA60 110 -> TRAIL
    await s.rot.runCycle();
    assert.strictEqual(s.j.floating, null);
    assert.strictEqual(s.j.history[0].reason, 'TRAIL');
    assert.strictEqual(s.j.stats.wins, 1);
    assert.deepStrictEqual(s.sent.map((m) => m.split(' ')[0]), ['OPEN', 'PARTIAL', 'CLOSED']);
    assert.strictEqual(s.ex.positions['BTC-USDT|LONG'].positionAmt, 0);
  });
  await t('long kena SL sebelum partial -> rugi kecatat', async () => {
    const s = setup({ signals: { SOL: { direction: 'buy', sl: 45, patternType: 'fvg_bounce' } } });
    await s.rot.runCycle();
    s.st.prices.SOL = 44.5;
    await s.rot.runCycle();
    assert.strictEqual(s.j.history[0].reason, 'SL');
    assert.strictEqual(s.j.stats.losses, 1);
    assert.ok(s.j.stats.totalPnlUsd < 0);
  });
  await t('short pas window bear -> window ganti ke bull -> tutup paksa WINDOW_FLIP', async () => {
    const s = setup({ bear: true, signals: { ETH: { direction: 'sell', sl: 2700, patternType: 'fvg_bounce_bear' } } });
    await s.rot.runCycle();
    assert.strictEqual(s.j.floating.direction, 'sell');
    s.st.bear = false;
    await s.rot.runCycle();
    assert.strictEqual(s.j.history[0].reason, 'WINDOW_FLIP');
  });
  await t('posisi hilang dari exchange (likuidasi/manual) -> ditutup jujur tanpa nebak PnL', async () => {
    const s = setup({ signals: { BNB: { direction: 'buy', sl: 650, patternType: 'flag_bull' } } });
    await s.rot.runCycle();
    s.ex.positions['BNB-USDT|LONG'].positionAmt = 0;
    await s.rot.runCycle();
    assert.strictEqual(s.j.history[0].reason, 'OFFLINE_UNTRACKED');
    assert.strictEqual(s.j.history[0].pnlUsd, null);
    assert.strictEqual(s.sent[s.sent.length - 1], 'UNTRACKED BNB');
  });
  await t('posisi digabung hedge mode (Ninja searah di simbol sama) -> rotasi cuma nutup jumlah MILIKNYA, sisa Ninja utuh', async () => {
    const s = setup({ signals: { BTC: { direction: 'buy', sl: 90, patternType: 'flag_bull' } } });
    await s.rot.runCycle();
    const own = s.j.floating.qty;
    s.ex.positions['BTC-USDT|LONG'].positionAmt = Number((own + 0.25).toFixed(3)); // Ninja ikut long 0.25
    s.st.prices.BTC = 89; // kena SL
    await s.rot.runCycle();
    assert.strictEqual(s.j.history[0].reason, 'SL');
    assert.ok(Math.abs(s.ex.positions['BTC-USDT|LONG'].positionAmt - 0.25) < 1e-9, `sisa Ninja harusnya 0.25, dapet ${s.ex.positions['BTC-USDT|LONG'].positionAmt}`);
  });
  await t('koin yang lagi dipakai modul lain (Ninja pending limit, belum jadi posisi) dilewati', async () => {
    const s = setup({ signals: { BTC: { direction: 'buy', sl: 95, patternType: 'flag_bull' }, SOL: { direction: 'buy', sl: 45, patternType: 'fvg_bounce' } } });
    s.rot = require('./rangerRotation').createRotation({ ...s.deps, isCoinBusy: async (c) => c === 'BTC' });
    await s.rot.runCycle();
    assert.strictEqual(s.j.floating.coin, 'SOL');
  });
  await t('SL yang udah kelewat harga live -> gak entry (jangan buka posisi yang langsung rugi)', async () => {
    const s = setup({ signals: { BTC: { direction: 'buy', sl: 101, patternType: 'flag_bull' } } });
    await s.rot.runCycle();
    assert.strictEqual(s.j.floating, null);
  });
  console.log(`\n${passed} lolos, ${failed} gagal`);
  process.exit(failed ? 1 : 0);
})();
