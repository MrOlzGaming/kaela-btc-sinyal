// backtest/sniperGoldWindowParity.js (4 Okt 2026, audit paritas live vs backtest) -- Sniper EMAS live (sniperAutoAnalysis.js):
// pas harga < SMA200 harian, sinyal LONG baru dimatiin (bearWindowActive), short Emas gak dieksekusi (info-only, dimatiin 3 Okt),
// dan tutup paksa WINDOW_FLIP cuma jalan pas isTestnet() (global udah real sejak 26 Sep -> gak jalan). Konfigurasi persis ini
// ("gerbang long doang, tanpa short, tanpa tutup paksa") BELUM pernah diuji sendiri -- yang diuji 13 Sep cuma window 2 arah
// (lebih jelek) vs buy-only polos. Bandingin pakai mesin validasi Sniper (runFlagBacktestWindowGated, flag+wedge harian --
// FVG gak ikut, jadi ini pendekatan), exit jalur Emas sekarang (1/2 @2R + trail SMA10) & trailing 3x.
// Pakai: node backtest/sniperGoldWindowParity.js
const path = require('path');
const { runFlagBacktestWindowGated } = require('../backtestFlagBreakout');
const daily = require(path.join(__dirname, 'gold-daily-cache.json'));
const SPLIT = Date.UTC(2023, 0, 1), START = Date.UTC(2010, 0, 1);

// window bear Emas = close harian < SMA200 (SAMA definisi live), tanpa look-ahead (pakai candle hari itu yg udah close)
const bearByTime = new Map();
let s = 0;
for (let i = 0; i < daily.length; i++) {
  s += daily[i].close; if (i >= 200) s -= daily[i - 200].close;
  bearByTime.set(daily[i].closeTime, i >= 199 && daily[i].close < s / 200);
}
const goldBear = (d) => bearByTime.get(d.getTime()) || false;
const pf = (tr) => { let w = 0, l = 0; for (const t of tr) { if (t.rMultiple > 0) w += t.rMultiple; else l -= t.rMultiple; } return l ? w / l : (w ? 99 : 0); };
const R = (tr) => tr.reduce((a, t) => a + t.rMultiple, 0);
const fmt = (tr) => `n${tr.length} PF ${pf(tr).toFixed(2)} R ${R(tr) >= 0 ? '+' : ''}${R(tr).toFixed(1)}`;

const EXITS = [['exit jalur Emas (1/2 @2R + SMA10)', {}], ['exit trailing 3x', { trailR: 3 }]];
const CONFIGS = [
  ['buy-only polos (tanpa window)', { bearWindowFn: () => false, allowShort: false }],
  ['LIVE: gerbang long, tanpa short/FC', { bearWindowFn: goldBear, allowShort: false, forceCloseOnFlip: false }],
  ['gerbang long + tutup paksa', { bearWindowFn: goldBear, allowShort: false, forceCloseOnFlip: true }],
];
console.log(`Emas harian ${daily.length} candle, dinilai dari ${new Date(START).toISOString().slice(0, 10)} (R-multiple, flag+wedge)`);
for (const [en, eo] of EXITS) {
  console.log(`\n== ${en} ==`);
  for (const [cn, co] of CONFIGS) {
    const tr = runFlagBacktestWindowGated(daily, { ...eo, ...co }).trades.filter((t) => t.exitTime >= START);
    const e1 = tr.filter((t) => t.exitTime < SPLIT), e2 = tr.filter((t) => t.exitTime >= SPLIT);
    console.log(`  ${cn.padEnd(36)} | semua ${fmt(tr)} | 2010-2022 ${fmt(e1)} | >=2023 ${fmt(e2)} | short ${tr.filter((t) => t.direction === 'sell').length}`);
  }
}
