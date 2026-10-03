// rangerExitResearch.js (3 Okt 2026) -- Olan: "trailing TP ultimate" + "profit konsisten, kekuatan manajemen resiko".
// Riset CARA KELUAR Ranger 4H (entry TETAP persis engine Ranger: flag -> wedge -> FVG, window halving, RESCALED_4H,
// aturan Olan alt LONG doang / short cuma BTC). Yang divariasikan cuma exit:
//   - partial: ambil untung sebagian (50% / 33%) di xR (1,5 / 2 / 3) lalu SL sisa ke titik masuk (breakeven); atau TANPA partial
//   - trailing sisa: SMA-N close (30/60/90/120 candle 4H), Chandelier ATR (high tertinggi sejak entry - m x ATR14, m 3/5/8),
//     atau GABUNGAN (stop = yang lebih ketat dari SMA & Chandelier)
// Konvensi SAMA buat semua varian (adil): stop (SL/BE/Chandelier) kena intrabar -> keluar di harga stop (gap -> open);
// SMA patah dinilai di CLOSE -> keluar di close; window ganti -> tutup di close. Fee 0,12% notional per trade.
// Output: per varian -> BTC sendiri & 8 koin rotasi: n, PF, rata2 %/trade, era <2023 / >=2023, + simulasi rotasi 1 posisi
// (modal penuh, sizing hitungExposure modal/5 PERSIS Ranger) CAGR & DD (tertutup) per era.
// Pakai: node backtest/rangerExitResearch.js <multicoinCacheDir>

const fs = require('fs');
const path = require('path');
const { detectFlag, detectWedge } = require('../chartPatterns');
const { detectFvgSignalBoth, makeBtcBearWindowFn, resampleTo4h, RESCALED_4H } = require('./rangerChartPatternFvg');
const { hitung: hitungExposure } = require('../calculator');

const FEE = 0.12, SPLIT = Date.UTC(2023, 0, 1);
const COINS = process.env.COINS ? process.env.COINS.split(',') : ['BTC', 'SOL', 'DOGE', 'TRX', 'INJ', 'ETH', 'XLM', 'BNB'];
// NOBEAR=1 -> window bear selalu false (aturan Ranger EMAS live: long doang, gak ikut siklus halving BTC)
const NOBEAR = process.env.NOBEAR === '1';
const P = { poleMinMovePct: 15, flagMaxRangePct: 8, wedgeMinTouches: 2, wedgeConvergenceRatio: 0.65, slBufferPct: 0.5, ...RESCALED_4H };

function smaArr(c, n) { const o = new Array(c.length).fill(null); let s = 0; for (let i = 0; i < c.length; i++) { s += c[i].close; if (i >= n) s -= c[i - n].close; if (i >= n - 1) o[i] = s / n; } return o; }
function atrArr(c, n = 14) { const o = new Array(c.length).fill(null); let a = null; for (let i = 1; i < c.length; i++) { const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)); a = a === null ? tr : (a * (n - 1) + tr) / n; if (i >= n) o[i] = a; } return o; }

// Sinyal per candle (independen dari state posisi) -- PERSIS urutan engine runNyopetV2BacktestWindowGated.
function precomputeSignals(c, coin) {
  const bearFn = makeBtcBearWindowFn();
  const out = new Array(c.length).fill(null), bear = new Array(c.length).fill(false);
  const shortOk = coin === 'BTC';
  for (let i = P.warmupCandles; i < c.length; i++) {
    const bearNow = NOBEAR ? false : bearFn(c, i); bear[i] = bearNow;
    const last = c[i].close;
    let s = null;
    const flag = detectFlag(c, i, { poleLookbackRange: P.poleLookbackRange, poleMinMovePct: P.poleMinMovePct, flagLookbackRange: P.flagLookbackRange, flagMaxRangePct: P.flagMaxRangePct });
    if (!bearNow && flag && flag.type === 'bull' && last > flag.flagHigh) s = { dir: 'buy', sl: flag.flagLow * (1 - P.slBufferPct / 100) };
    else if (bearNow && flag && flag.type === 'bear' && last < flag.flagLow) s = { dir: 'sell', sl: flag.flagHigh * (1 + P.slBufferPct / 100) };
    if (!s) {
      const w = detectWedge(c, i, { wedgeLookbackRange: P.wedgeLookbackRange, minTouches: P.wedgeMinTouches, convergenceRatio: P.wedgeConvergenceRatio });
      if (bearNow && w && w.type === 'rising' && last < w.projectedSupport) s = { dir: 'sell', sl: w.recentSwingHigh * (1 + P.slBufferPct / 100) };
      else if (!bearNow && w && w.type === 'falling' && last > w.projectedResistance) s = { dir: 'buy', sl: w.recentSwingLow * (1 - P.slBufferPct / 100) };
    }
    if (!s) {
      const fv = detectFvgSignalBoth(c, i, { slBufferPct: P.slBufferPct, trendSmaLen: P.fvgTrendSmaLen, allowShort: true });
      if (fv && ((fv.direction === 'buy' && !bearNow) || (fv.direction === 'sell' && bearNow))) s = { dir: fv.direction, sl: fv.sl };
    }
    if (s && s.dir === 'sell' && !shortOk) s = null; // aturan Olan
    if (s && Math.abs(last - s.sl) > 0) out[i] = s;
  }
  return { sig: out, bear };
}

function runVariant(c, pre, ind, v) {
  const trades = [];
  let pos = null;
  for (let i = P.warmupCandles; i < c.length; i++) {
    const x = c[i];
    if (pos) {
      const L = pos.dir === 'buy';
      const sgn = L ? 1 : -1;
      const mv = (px) => ((px - pos.entry) / pos.entry) * 100 * sgn;
      const done = (exitPx, reason) => {
        const rest = pos.partialDone ? 1 - v.partialFrac : 1;
        const net = (pos.partialDone ? v.partialFrac * pos.partialMv : 0) + rest * mv(exitPx) - FEE;
        trades.push({ t: c[pos.idx].openTime, net, notionalFrac: pos.notionalFrac, reason, bars: i - pos.idx });
        pos = null;
      };
      const flip = (L && pre.bear[i]) || (!L && !pre.bear[i]);
      if (flip) { done(x.close, 'FLIP'); continue; }
      // stop aktif: SL awal (sebelum partial) / BE + trailing (sesudah partial, atau varian tanpa partial yg trailing dari awal)
      if (pos.trailing && v.chand) {
        if (L) pos.ext = Math.max(pos.ext, x.high); else pos.ext = Math.min(pos.ext, x.low);
        const ch = ind.atr[i - 1] ? (L ? pos.ext - v.chand * ind.atr[i - 1] : pos.ext + v.chand * ind.atr[i - 1]) : null;
        if (ch !== null) pos.stop = L ? Math.max(pos.stop, ch) : Math.min(pos.stop, ch);
      }
      const stopHit = L ? x.low <= pos.stop : x.high >= pos.stop;
      // (3 Okt 2026, ATURAN OLAN) trailR: stop = harga terbaik - trailR x JARAK INVALIDASI AWAL, aktif dari entry, cuma naik.
      // Dicek SETELAH stopHit candle ini (pakai stop lama), update buat candle berikutnya -- gak ngintip intrabar.
      const olanTrail = () => { if (!v.trailR) return; if (L) { pos.peak = Math.max(pos.peak, x.high); pos.stop = Math.max(pos.stop, pos.peak - v.trailR * pos.risk); } else { pos.peak = Math.min(pos.peak, x.low); pos.stop = Math.min(pos.stop, pos.peak + v.trailR * pos.risk); } };
      if (stopHit) { done(L ? Math.min(x.open, pos.stop) : Math.max(x.open, pos.stop), pos.trailing || v.trailR ? 'TRAIL_STOP' : 'SL'); continue; }
      olanTrail();
      // (3 Okt 2026, Olan: "biar ga kena gocek bandar.. profit ke kunci") -- opsi kunci BE LEBIH AWAL: begitu untung >= beAt x R
      // (sebelum target partial), stop digeser ke titik masuk. Dicek pakai high/low candle INI, efektif mulai candle berikutnya.
      if (v.beAt && !pos.partialDone && !pos.beEarly && (L ? x.high >= pos.entry + pos.risk * v.beAt : x.low <= pos.entry - pos.risk * v.beAt)) {
        pos.beEarly = true; pos.stop = L ? Math.max(pos.stop, pos.entry) : Math.min(pos.stop, pos.entry);
      }
      if (!pos.partialDone && v.partialRR) {
        const tp = pos.entry + sgn * pos.risk * v.partialRR;
        if (L ? x.high >= tp : x.low <= tp) {
          pos.partialDone = true; pos.partialMv = mv(tp); pos.trailing = true;
          pos.stop = L ? Math.max(pos.stop, pos.entry) : Math.min(pos.stop, pos.entry);
          pos.ext = L ? x.high : x.low;
          continue;
        }
      }
      if (!v.partialRR && !pos.trailing && !v.trailR) {
        // tanpa partial: trailing aktif begitu untung >= 1R (stop ke BE dulu)
        if (L ? x.high >= pos.entry + pos.risk : x.low <= pos.entry - pos.risk) { pos.trailing = true; pos.stop = L ? Math.max(pos.stop, pos.entry) : Math.min(pos.stop, pos.entry); pos.ext = L ? x.high : x.low; }
      }
      if ((pos.trailing || v.smaFromStart) && v.sma) {
        const s = ind.sma[v.sma][i];
        if (s !== null && (L ? x.close < s : x.close > s)) { done(x.close, 'TRAIL_SMA'); continue; }
      }
      continue;
    }
    const s = pre.sig[i];
    if (!s) continue;
    const calc = hitungExposure({ modal: 100 / 5, entry: x.close, stopLoss: s.sl, direction: s.dir });
    if (!(calc.nilaiPosisi > 0) || calc.margin > 100 || calc.margin > 20) continue; // maxMarginPct 20 = engine
    pos = { dir: s.dir, entry: x.close, idx: i, risk: Math.abs(x.close - s.sl), stop: s.sl, peak: x.close, partialDone: false, partialMv: 0, trailing: false, ext: x.close, notionalFrac: calc.nilaiPosisi / 100 };
  }
  return trades;
}

function stats(tr) {
  if (!tr.length) return { n: 0, pf: NaN, avg: NaN, sum: 0 };
  let w = 0, l = 0; for (const t of tr) { if (t.net > 0) w += t.net; else l -= t.net; }
  const sum = tr.reduce((a, t) => a + t.net, 0);
  return { n: tr.length, pf: l ? w / l : Infinity, avg: sum / tr.length, sum };
}
function rotation(all, start, end) {
  let eq = 100, peak = 100, dd = 0, taken = 0; let busyUntil = -Infinity;
  const ev = all.filter((t) => t.t >= start && t.t < end).sort((a, b) => a.t - b.t);
  for (const t of ev) { if (t.t < busyUntil) continue; eq += eq * t.notionalFrac * t.net / 100; peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak * 100); busyUntil = t.tClose; taken++; }
  const yrs = (Math.min(end, Date.now()) - start) / (365.25 * 864e5);
  return { eq, dd, taken, cagr: (Math.pow(Math.max(eq, 1e-9) / 100, 1 / yrs) - 1) * 100 };
}
const f = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : String(v));

const VARIANTS = process.env.TRAIL_STUDY ? [
  { name: 'SEKARANG alt: 1/3 @2R, SMA60', partialRR: 2, partialFrac: 1 / 3, sma: 60 },
  { name: 'SEKARANG emas: 1/2 @3R, SMA60', partialRR: 3, partialFrac: 0.5, sma: 60 },
  { name: 'OLAN murni: trail 1.0x invalidasi', partialRR: null, partialFrac: 0, trailR: 1 },
  { name: 'OLAN trail 1.5x invalidasi', partialRR: null, partialFrac: 0, trailR: 1.5 },
  { name: 'OLAN trail 2.0x invalidasi', partialRR: null, partialFrac: 0, trailR: 2 },
  { name: 'OLAN trail 2.5x invalidasi', partialRR: null, partialFrac: 0, trailR: 2.5 },
  { name: 'OLAN trail 3.0x invalidasi', partialRR: null, partialFrac: 0, trailR: 3 },
  { name: 'OLAN 1.0x + partial 1/3 @2R', partialRR: 2, partialFrac: 1 / 3, trailR: 1 },
  { name: 'OLAN 1.5x + partial 1/3 @2R', partialRR: 2, partialFrac: 1 / 3, trailR: 1.5 },
  { name: 'OLAN 1.0x + SMA60 (mana yg duluan)', partialRR: null, partialFrac: 0, trailR: 1, sma: 60, smaFromStart: true },
  { name: 'OLAN 1.5x + partial 1/3 @2R + SMA60', partialRR: 2, partialFrac: 1 / 3, trailR: 1.5, sma: 60 },
] : process.env.BE_STUDY ? [
  { name: 'SEKARANG: 1/3 @2R, SMA60', partialRR: 2, partialFrac: 1 / 3, sma: 60 },
  { name: '1/3 @2R, SMA60, BE di 1R', partialRR: 2, partialFrac: 1 / 3, sma: 60, beAt: 1 },
  { name: '1/3 @2R, SMA60, BE di 1.5R', partialRR: 2, partialFrac: 1 / 3, sma: 60, beAt: 1.5 },
  { name: '1/2 @3R, SMA60 (emas)', partialRR: 3, partialFrac: 0.5, sma: 60 },
  { name: '1/2 @3R, SMA60, BE di 1R', partialRR: 3, partialFrac: 0.5, sma: 60, beAt: 1 },
  { name: '1/2 @3R, SMA60, BE di 1.5R', partialRR: 3, partialFrac: 0.5, sma: 60, beAt: 1.5 },
  { name: '1/2 @3R, SMA60, BE di 2R', partialRR: 3, partialFrac: 0.5, sma: 60, beAt: 2 },
] : [
  { name: 'SEKARANG: partial 50% @2R, trail SMA60', partialRR: 2, partialFrac: 0.5, sma: 60 },
  { name: 'partial 50% @2R, trail SMA30', partialRR: 2, partialFrac: 0.5, sma: 30 },
  { name: 'partial 50% @2R, trail SMA90', partialRR: 2, partialFrac: 0.5, sma: 90 },
  { name: 'partial 50% @2R, trail SMA120', partialRR: 2, partialFrac: 0.5, sma: 120 },
  { name: 'partial 50% @1.5R, trail SMA60', partialRR: 1.5, partialFrac: 0.5, sma: 60 },
  { name: 'partial 50% @3R, trail SMA60', partialRR: 3, partialFrac: 0.5, sma: 60 },
  { name: 'partial 33% @2R, trail SMA60', partialRR: 2, partialFrac: 1 / 3, sma: 60 },
  { name: 'TANPA partial, BE@1R, trail SMA60', partialRR: null, partialFrac: 0, sma: 60 },
  { name: 'TANPA partial, BE@1R, trail SMA90', partialRR: null, partialFrac: 0, sma: 90 },
  { name: 'partial 50% @2R, Chandelier 3xATR', partialRR: 2, partialFrac: 0.5, chand: 3 },
  { name: 'partial 50% @2R, Chandelier 5xATR', partialRR: 2, partialFrac: 0.5, chand: 5 },
  { name: 'partial 50% @2R, Chandelier 8xATR', partialRR: 2, partialFrac: 0.5, chand: 8 },
  { name: 'partial 50% @2R, SMA60 + Chandelier 5x', partialRR: 2, partialFrac: 0.5, sma: 60, chand: 5 },
  { name: 'TANPA partial, BE@1R, Chandelier 5x', partialRR: null, partialFrac: 0, chand: 5 },
  { name: 'TANPA partial, BE@1R, SMA90 + Chandelier 8x', partialRR: null, partialFrac: 0, sma: 90, chand: 8 },
];

// (3 Okt 2026) bisa di-require (backtest/topTraderPrinciples.js) -- main cuma jalan kalau dipanggil langsung
module.exports = { precomputeSignals, runVariant, smaArr, atrArr, P, FEE };
if (require.main === module) (function main() {
  const dir = process.argv[2];
  const data = {};
  for (const coin of COINS) {
    const h = JSON.parse(fs.readFileSync(path.join(dir, `${coin}USDT-1h.json`), 'utf8'));
    const c = resampleTo4h(h);
    const ind = { atr: atrArr(c), sma: { 30: smaArr(c, 30), 60: smaArr(c, 60), 90: smaArr(c, 90), 120: smaArr(c, 120) } };
    data[coin] = { c, ind, pre: precomputeSignals(c, coin) };
    console.error(`${coin}: ${c.length} candle, sinyal ${data[coin].pre.sig.filter(Boolean).length}`);
  }
  console.log(`=== Riset EXIT Ranger 4H (entry tetap, alt LONG doang/short cuma BTC, fee ${FEE}%) ===`);
  const ONLY = process.env.ONLY;
  for (const v of VARIANTS.filter((x) => !ONLY || x.name.startsWith(ONLY))) {
    const btc = [], all = [];
    for (const coin of COINS) {
      const { c, ind, pre } = data[coin];
      const tr = runVariant(c, pre, ind, v).map((t) => ({ ...t, coin, tClose: c[c.findIndex((x) => x.openTime === t.t) + t.bars].closeTime }));
      all.push(...tr); if (coin === 'BTC') btc.push(...tr);
    }
    if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(all.map((t) => ({ coin: t.coin, t: t.t, tClose: t.tClose, net: t.net, notionalFrac: t.notionalFrac }))));
    const b = stats(btc), b1 = stats(btc.filter((t) => t.t < SPLIT)), b2 = stats(btc.filter((t) => t.t >= SPLIT));
    const a1 = stats(all.filter((t) => t.t < SPLIT)), a2 = stats(all.filter((t) => t.t >= SPLIT));
    const r1 = rotation(all, Date.UTC(2019, 8, 1), SPLIT), r2 = rotation(all, SPLIT, Infinity);
    console.log(`${v.name.padEnd(46)} | BTC n=${b.n} PF ${f(b.pf)} avg ${f(b.avg)}% (<23 PF ${f(b1.pf)} | >=23 PF ${f(b2.pf)})`
      + ` | 8koin <23 PF ${f(a1.pf)} avg ${f(a1.avg)}% | >=23 PF ${f(a2.pf)} avg ${f(a2.avg)}%`
      + ` | ROTASI <23 CAGR ${f(r1.cagr, 0)}% DD ${f(r1.dd, 0)}% | >=23 CAGR ${f(r2.cagr, 0)}% DD ${f(r2.dd, 0)}%`);
  }
})();
