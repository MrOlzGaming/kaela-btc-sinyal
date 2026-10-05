// rangerRotation.selftest.js (3 Okt 2026, v2) -- alur penuh Ranger Rotasi dgn exchange PALSU (gak ada network/WA/order asli).
const assert = require('assert');
const { createRotation, freshJournal } = require('./rangerRotation');

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  OK  ', name); } catch (e) { failed++; console.log('  GAGAL', name, '\n   ', e.message); } }

function fakeExchange(balance) {
  const positions = {}; // `${symbol}|${side}` -> {positionAmt}
  const orders = [];
  const ex = {
    positions, orders, _px: 0,
    async getSymbolInfo() { return { stepSize: 0.001, quantityPrecision: 3 }; },
    roundToStepSize(q, step, prec) { return Number((Math.floor(q / step) * step).toFixed(prec)); },
    async getPositionRisk(symbol) { const k = Object.keys(positions).find((x) => x.startsWith(symbol + '|') && positions[x].positionAmt > 0); return k ? positions[k] : null; },
    async getPositionBySide(symbol, side) { const p = positions[`${symbol}|${side}`]; return p && p.positionAmt > 0 ? { ...p } : null; },
    async setIsolatedMargin() {}, async setLeverage() {},
    async placeMarketEntry({ symbol, direction, notionalUsd, livePrice }) {
      const qty = Number((notionalUsd / livePrice).toFixed(3));
      const k = `${symbol}|${direction === 'buy' ? 'LONG' : 'SHORT'}`;
      positions[k] = { positionAmt: Number(((positions[k] ? positions[k].positionAmt : 0) + qty).toFixed(3)) };
      orders.push({ type: 'open', symbol, direction, qty });
      return { avgPrice: String(livePrice), executedQty: String(qty) };
    },
    async emergencyCloseMarket({ symbol, direction, quantity }) {
      const k = `${symbol}|${direction === 'buy' ? 'LONG' : 'SHORT'}`;
      positions[k].positionAmt = Number((positions[k].positionAmt - quantity).toFixed(3));
      orders.push({ type: 'close', symbol, quantity });
      return { order: { avgPrice: String(ex._px) } };
    },
  };
  ex.balance = balance;
  return ex;
}

function setup({ signals = {}, bear = false, prices = {}, closeTime, realBalance = 0, allowReal = true, shortCoins = ['BTC'] } = {}) {
  const st = { prices: { BTC: 100, SOL: 50, DOGE: 0.1, TRX: 0.3, INJ: 7, ETH: 2600, XLM: 0.2, BNB: 700, ...prices }, trail: null, bear };
  const demoEx = fakeExchange(100000), realEx = fakeExchange(realBalance);
  const venue = (ex) => ({ exec: ex, balance: async () => ex.balance, price: async (coin) => { ex._px = st.prices[coin]; return st.prices[coin]; } });
  const j = freshJournal();
  const sent = { club: [], wibowo: [] };
  const journalCalls = [];
  const candleClose = closeTime || Date.UTC(2026, 9, 3, 12, 0) - 1;
  const deps = {
    cfg: { enabled: true, coins: ['BTC', 'SOL', 'DOGE', 'TRX', 'INJ', 'ETH', 'XLM', 'BNB'], dxyFilter: false, allowReal, shortCoins, exchange: 'fake' },
    journal: j, legs: { demo: venue(demoEx), real: venue(realEx) }, symbolOf: (c) => `${c}USDT`,
    fetchCandles: async (coin, n) => {
      if (n < 100) {
        const arr = Array.from({ length: 65 }, () => ({ close: st.trail === null ? st.prices[coin] : st.trail, closeTime: candleClose }));
        if (st.lastClose != null) arr[arr.length - 1] = { close: st.lastClose, closeTime: candleClose }; // close candle 4H terakhir
        return arr;
      }
      return Array.from({ length: 400 }, () => ({ close: st.prices[coin], closeTime: candleClose }));
    },
    notify: { sniperClub: async (m) => { sent.club.push(m); }, wibowo: async (m) => { sent.wibowo.push(m); } },
    now: () => Date.UTC(2026, 9, 3, 12, 5), isBear: () => st.bear, dxyWeak: async () => true, log: () => {},
    signalFn: (c, bearNow, shortAllowed, coin) => signals[coin] || null,
    kaelaJournal: { record: (mode, e) => journalCalls.push(['record', mode, e.entryId]), update: (id, p) => journalCalls.push(['update', id, p.status]) },
    fmt: {
      open: (f, m) => `OPEN ${m} ${f.coin}`, partial: (f, m) => `PARTIAL ${m} ${f.coin}`,
      closed: (f, m, r) => `CLOSED ${m} ${f.coin} ${r} ${f.legs[m].pnlUsd === null ? 'null' : f.legs[m].pnlUsd.toFixed(2)}`, untracked: (f, m) => `UNTRACKED ${m} ${f.coin}`,
    },
  };
  const rot = createRotation(deps);
  return { demoEx, realEx, j, sent, rot, st, deps, journalCalls };
}

(async () => {
  await t('demo-only (saldo real 0): buka demo di koin prioritas, Wibowo dapet pesan DEMO (bukan dobel)', async () => {
    const s = setup({ signals: { DOGE: { direction: 'buy', sl: 0.09, patternType: 'fvg_bounce' }, ETH: { direction: 'buy', sl: 2500, patternType: 'flag_bull' } } });
    await s.rot.runCycle();
    assert.strictEqual(s.j.floating.coin, 'DOGE');
    assert.strictEqual(s.j.floating.wibowoRoute, 'demo');
    assert.strictEqual(s.j.floating.legs.real, null);
    assert.deepStrictEqual(s.sent.club, ['OPEN demo DOGE']);
    assert.deepStrictEqual(s.sent.wibowo, ['OPEN demo DOGE']);
    assert.ok(Math.abs(s.j.floating.partialTp - 0.12) < 1e-9);
  });
  await t('demo+real (saldo real cukup): 2 leg kebuka, Sniper Club = demo, Wibowo = REAL, jurnal Kaela Access dicatat', async () => {
    const s = setup({ realBalance: 500, signals: { SOL: { direction: 'buy', sl: 45, patternType: 'flag_bull' } } });
    await s.rot.runCycle();
    assert.ok(s.j.floating.legs.real && s.j.floating.legs.real.qty > 0);
    assert.strictEqual(s.j.floating.wibowoRoute, 'real');
    assert.deepStrictEqual(s.sent.club, ['OPEN demo SOL']);
    assert.deepStrictEqual(s.sent.wibowo, ['OPEN real SOL']);
    assert.strictEqual(s.journalCalls[0][0], 'record');
  });
  await t('ATURAN OLAN: alt short GAK pernah dibuka (window bear), BTC short boleh', async () => {
    const s = setup({ bear: true, signals: { SOL: { direction: 'sell', sl: 55, patternType: 'wedge_rising' }, ETH: { direction: 'sell', sl: 2700, patternType: 'wedge_rising' } } });
    await s.rot.runCycle();
    assert.strictEqual(s.j.floating, null, 'alt short harusnya gak dibuka');
    const s2 = setup({ bear: true, signals: { BTC: { direction: 'sell', sl: 105, patternType: 'fvg_bounce_bear' } } });
    await s2.rot.runCycle();
    assert.strictEqual(s2.j.floating.direction, 'sell');
  });
  await t('2 leg: 2R -> partial tiap leg, trailing patah -> tutup tiap leg, stats per leg, jurnal real di-update', async () => {
    const s = setup({ realBalance: 500, signals: { BTC: { direction: 'buy', sl: 90, patternType: 'flag_bull' } } });
    await s.rot.runCycle();
    s.st.prices.BTC = 121; s.st.trail = 110;
    await s.rot.runCycle();
    assert.ok(s.j.floating.legs.demo.partialDone && s.j.floating.legs.real.partialDone);
    // (5 Okt 2026) harga live sesaat di bawah SMA60 TAPI candle 4H belum tutup di bawahnya -> TETAP pegang (sama backtest)
    s.st.prices.BTC = 108;
    await s.rot.runCycle();
    assert.ok(s.j.floating, 'ekor candle sesaat di bawah SMA60 gak boleh bikin keluar');
    s.st.lastClose = 108; // candle 4H TUTUP di bawah SMA60 -> trailing patah
    await s.rot.runCycle();
    assert.strictEqual(s.j.floating, null);
    assert.strictEqual(s.j.stats.demo.wins, 1); assert.strictEqual(s.j.stats.real.wins, 1);
    assert.strictEqual(s.demoEx.positions['BTCUSDT|LONG'].positionAmt, 0);
    assert.strictEqual(s.realEx.positions['BTCUSDT|LONG'].positionAmt, 0);
    assert.deepStrictEqual(s.sent.club, ['OPEN demo BTC', 'PARTIAL demo BTC', s.sent.club[2]]);
    assert.ok(/^CLOSED demo BTC TRAIL/.test(s.sent.club[2]));
    assert.deepStrictEqual(s.sent.wibowo.map((m) => m.split(' ').slice(0, 2).join(' ')), ['OPEN real', 'PARTIAL real', 'CLOSED real']);
    assert.ok(s.journalCalls.some((c) => c[0] === 'update' && c[2] === 'closed'));
    assert.strictEqual(s.j.history[0].coin, 'BTC');
  });
  await t('SL sebelum partial -> rugi kecatat per leg', async () => {
    const s = setup({ signals: { SOL: { direction: 'buy', sl: 45, patternType: 'fvg_bounce' } } });
    await s.rot.runCycle();
    s.st.prices.SOL = 44.5;
    await s.rot.runCycle();
    assert.strictEqual(s.j.history[0].legs.demo.reason, 'SL');
    assert.strictEqual(s.j.stats.demo.losses, 1);
  });
  await t('BTC short pas bear -> window ganti ke bull -> tutup paksa WINDOW_FLIP', async () => {
    const s = setup({ bear: true, signals: { BTC: { direction: 'sell', sl: 105, patternType: 'fvg_bounce_bear' } } });
    await s.rot.runCycle();
    s.st.bear = false;
    await s.rot.runCycle();
    assert.strictEqual(s.j.history[0].legs.demo.reason, 'WINDOW_FLIP');
  });
  await t('posisi hilang dari exchange -> ditutup jujur tanpa nebak PnL', async () => {
    const s = setup({ signals: { BNB: { direction: 'buy', sl: 650, patternType: 'flag_bull' } } });
    await s.rot.runCycle();
    s.demoEx.positions['BNBUSDT|LONG'].positionAmt = 0;
    await s.rot.runCycle();
    assert.strictEqual(s.j.history[0].legs.demo.reason, 'OFFLINE_UNTRACKED');
    assert.strictEqual(s.j.history[0].legs.demo.pnlUsd, null);
  });
  await t('posisi lain (bukan rotasi) di simbol itu -> koin dilewati, posisi lain GAK disentuh', async () => {
    const s = setup({ signals: { BTC: { direction: 'buy', sl: 95, patternType: 'flag_bull' }, SOL: { direction: 'buy', sl: 45, patternType: 'fvg_bounce' } } });
    s.demoEx.positions['BTCUSDT|SHORT'] = { positionAmt: 0.5 };
    await s.rot.runCycle();
    assert.strictEqual(s.j.floating.coin, 'SOL');
    assert.strictEqual(s.demoEx.positions['BTCUSDT|SHORT'].positionAmt, 0.5);
  });
  await t('posisi digabung (modul lain searah di simbol sama) -> cuma nutup jumlah MILIKNYA', async () => {
    const s = setup({ signals: { BTC: { direction: 'buy', sl: 90, patternType: 'flag_bull' } } });
    await s.rot.runCycle();
    const own = s.j.floating.legs.demo.qty;
    s.demoEx.positions['BTCUSDT|LONG'].positionAmt = Number((own + 0.25).toFixed(3));
    s.st.prices.BTC = 89;
    await s.rot.runCycle();
    assert.ok(Math.abs(s.demoEx.positions['BTCUSDT|LONG'].positionAmt - 0.25) < 1e-9);
  });
  await t('SIZING Olan: alt long = separuh exposure (kayak short), BTC long = full', async () => {
    // jarak SL sama (5%) -> nilai posisi alt harus ~separuh BTC (exposure dari kalkulator sama, cuma dibagi 2)
    const a = setup({ signals: { SOL: { direction: 'buy', sl: 47.5, patternType: 'flag_bull' } } });
    await a.rot.runCycle();
    const b = setup({ signals: { BTC: { direction: 'buy', sl: 95, patternType: 'flag_bull' } } });
    await b.rot.runCycle();
    const ratio = a.j.floating.legs.demo.nilaiPosisi / b.j.floating.legs.demo.nilaiPosisi;
    assert.ok(Math.abs(ratio - 0.5) < 1e-9, `rasio nilai posisi alt/BTC harusnya 0.5, dapet ${ratio}`);
  });
  await t('partial = 1/3 posisi (default), sisa 2/3 di-trail', async () => {
    const s = setup({ signals: { BTC: { direction: 'buy', sl: 90, patternType: 'flag_bull' } } });
    await s.rot.runCycle();
    const q = s.j.floating.legs.demo.qty;
    s.st.prices.BTC = 121; s.st.trail = 100;
    await s.rot.runCycle();
    const closedQty = s.demoEx.orders.filter((o) => o.type === 'close')[0].quantity;
    assert.ok(Math.abs(closedQty - Math.floor(q / 3 / 0.001) * 0.001) < 1e-9, `partial qty ${closedQty} vs 1/3 dari ${q}`);
    assert.ok(Math.abs(s.j.floating.legs.demo.remainingQty - (q - closedQty)) < 1e-6);
  });
  await t('SL NATIVE: kepasang pas entry, digeser ke BE abis partial, posisi ditutup exchange -> dicatat SL (bukan "hilang")', async () => {
    const s = setup({ signals: { BTC: { direction: 'buy', sl: 90, patternType: 'flag_bull' } } });
    const stops = [];
    s.demoEx.setPositionStopLoss = async (symbol, px) => { stops.push([symbol, px]); };
    await s.rot.runCycle();
    assert.deepStrictEqual(stops[0], ['BTCUSDT', 90]);
    assert.strictEqual(s.j.floating.legs.demo.nativeSl, true);
    s.st.prices.BTC = 121; s.st.trail = 100;
    await s.rot.runCycle();
    assert.deepStrictEqual(stops[1], ['BTCUSDT', 100], 'SL native harusnya digeser ke entry (100)');
    // exchange nutup posisi pas harga balik ke BE
    s.demoEx.positions['BTCUSDT|LONG'].positionAmt = 0;
    s.st.prices.BTC = 99.9;
    await s.rot.runCycle();
    const leg = s.j.history[0].legs.demo;
    assert.strictEqual(leg.reason, 'SL_BREAKEVEN');
    assert.strictEqual(leg.exitPrice, 100);
    assert.ok(leg.pnlUsd > 0, 'untung partial tetap kecatat');
  });
  await t('TRAILING OLAN (BTC 3x invalidasi): SL ngikut harga terbaik, cuma naik, tutup = TRAIL profit, gak ada TP tetap', async () => {
    const s = setup({ signals: { BTC: { direction: 'buy', sl: 90, patternType: 'flag_bull' } } });
    s.deps.cfg.trailRByCoin = { BTC: 3 };
    const rot = require('./rangerRotation').createRotation(s.deps);
    const stops = [];
    s.demoEx.setPositionStopLoss = async (symbol, px) => { stops.push(px); };
    await rot.runCycle();
    assert.strictEqual(s.j.floating.partialTp, null, 'koin trailing gak boleh punya TP tetap');
    s.st.prices.BTC = 120; await rot.runCycle();
    assert.strictEqual(s.j.floating.legs.demo.sl, 90, 'stop 120-30=90 belum naik');
    s.st.prices.BTC = 140; await rot.runCycle();
    assert.strictEqual(s.j.floating.legs.demo.sl, 110, 'stop harus naik ke 140-30=110');
    assert.strictEqual(stops[stops.length - 1], 110, 'SL native ikut digeser');
    s.st.prices.BTC = 130; await rot.runCycle();
    assert.strictEqual(s.j.floating.legs.demo.sl, 110, 'stop GAK boleh turun');
    s.st.prices.BTC = 109; await rot.runCycle();
    const leg = s.j.history[0].legs.demo;
    assert.strictEqual(leg.reason, 'TRAIL_STOP');
    assert.ok(leg.pnlUsd > 0, 'harus profit');
    assert.strictEqual(s.demoEx.orders.filter((o) => o.type === 'close').length, 1, 'tanpa partial: cuma 1 kali tutup');
  });
  await t('candle basi gak entry; candle sama gak discan ulang; SL kelewat harga live gak entry', async () => {
    const s = setup({ closeTime: Date.UTC(2026, 9, 3, 8, 0) - 1, signals: { BTC: { direction: 'buy', sl: 95, patternType: 'flag_bull' } } });
    await s.rot.runCycle(); await s.rot.runCycle();
    assert.strictEqual(s.demoEx.orders.length, 0);
    const s2 = setup({ signals: { BTC: { direction: 'buy', sl: 101, patternType: 'flag_bull' } } });
    await s2.rot.runCycle();
    assert.strictEqual(s2.j.floating, null);
  });
  console.log(`\n${passed} lolos, ${failed} gagal`);
  process.exit(failed ? 1 : 0);
})();
