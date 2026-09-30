// culikResearch.js (1 Okt 2026) -- riset "ambil dikit-dikit tapi sering" (Olan: "kerjakan yang penting
// kita bisa culik culik duit terus"). Dua jalur:
//
//   A. MR LONGGAR  -- Mean Reversion Ninja (live: 15M, Bollinger 2,5, searah EMA200, SL 4xATR, exit SMA20)
//                     dilonggarin (Bollinger 1,5/2/2,5/3, TF 5M/15M/30M/1H, filter tren on/off, SL 3/4xATR)
//                     -> apa bisa lebih SERING tanpa edge-nya habis dimakan fee?
//   B. CULIK CASCADE -- proxy likuidasi massal dari harga+volume: candle yang rentangnya >= m x ATR DAN
//                     volume >= v x rata2 20 candle DAN close mepet ujung (tutup di 25% terbawah/teratas)
//                     = tanda panic/force-close -> fade (lawan arah). Exit SMA20 atau retrace 50% candle.
//
// Model eksekusi = NIRU PERSIS ninjaMrTrader.js (live BingX):
//   - entry: LIMIT 1 tick di sisi baik close candle sinyal, berlaku 1 candle; fill cuma kalau candle
//     berikutnya TEMBUS limit (strict < / >) -> maker 0,02%. Gak tembus = sinyal lewat.
//   - SL: stop market k x ATR dari harga fill -> taker 0,05% + selip 0,01%. Kalau SL & exit kena di candle
//     yang sama -> dianggap SL (konservatif). Candle fill: cuma SL yang dicek (urutan intra-candle gak tau).
//   - exit mean: limit ngendap di SMA20 candle closed terakhir (maker 0,02%, fill kalau ditembus strict);
//     backup: close udah lewat SMA20 tapi limit gak ke-fill -> tutup market (taker+selip).
//   - 1 posisi aktif, gak ada sinyal baru di candle yang sama dengan exit.
// Periode: DEV 2019-10..2023-09 (buat milih), HOLDOUT 2023-10..2026-09 (gak disentuh buat milih).
// Satuan: % notional per trade (sebelum leverage). Pakai: node backtest/ninja/culikResearch.js <cache5m.json>

const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..', '..');
const { atrSeries, emaSeries } = require(path.join(R, 'backtestNinjaCandidates'));

const MAKER = 0.02, TAKER = 0.05, SLIP = 0.01, TICK = 1e-5;
const SPLIT = Date.UTC(2023, 9, 1);

function aggregate(c5, tfMin) {
  if (tfMin === 5) return c5;
  const ms = tfMin * 60e3, out = [];
  let cur = null;
  for (const x of c5) {
    const b = Math.floor(x.openTime / ms) * ms;
    if (!cur || cur.openTime !== b) { if (cur) out.push(cur); cur = { openTime: b, open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume || 0, closeTime: b + ms - 1 }; }
    else { cur.high = Math.max(cur.high, x.high); cur.low = Math.min(cur.low, x.low); cur.close = x.close; cur.volume += x.volume || 0; }
  }
  if (cur) out.push(cur);
  return out;
}

function prep(c) {
  const n = c.length, sma = new Array(n).fill(null), sd = new Array(n).fill(null), vavg = new Array(n).fill(null);
  let s = 0, s2 = 0, vs = 0;
  for (let i = 0; i < n; i++) {
    s += c[i].close; s2 += c[i].close * c[i].close; vs += c[i].volume || 0;
    if (i >= 20) { s -= c[i - 20].close; s2 -= c[i - 20].close * c[i - 20].close; vs -= c[i - 20].volume || 0; }
    if (i >= 19) { const m = s / 20; sma[i] = m; sd[i] = Math.sqrt(Math.max(0, s2 / 20 - m * m)); vavg[i] = vs / 20; }
  }
  return { sma, sd, vavg, atr: atrSeries(c), ema: emaSeries(c, 200) };
}

// sinyal di candle closed i -> {dir, fixedTarget?} | null
function sigMR(p, c, ind, i) {
  if (ind.sma[i] === null || ind.ema[i] === null) return null;
  const x = c[i], up = x.close > ind.ema[i];
  if (x.close < ind.sma[i] - p.bb * ind.sd[i] && (!p.trend || up)) return { dir: 'long' };
  if (x.close > ind.sma[i] + p.bb * ind.sd[i] && (!p.trend || !up)) return { dir: 'short' };
  return null;
}
function sigCascade(p, c, ind, i) {
  if (i < 1 || ind.vavg[i - 1] === null || ind.atr[i - 1] === null || ind.ema[i] === null) return null;
  const x = c[i], rng = x.high - x.low;
  if (!(rng >= p.m * ind.atr[i - 1]) || !((x.volume || 0) >= p.v * ind.vavg[i - 1])) return null;
  const pos = rng > 0 ? (x.close - x.low) / rng : 0.5, up = x.close > ind.ema[i];
  let dir = null;
  if (x.close < x.open && pos <= 0.25 && (!p.trend || up)) dir = 'long';   // dibanting turun -> tangkep pantulan
  if (x.close > x.open && pos >= 0.75 && (!p.trend || !up)) dir = 'short'; // dilempar naik -> tangkep balikan
  if (!dir) return null;
  return { dir, fixedTarget: p.exit === 'half' ? (dir === 'long' ? x.close + rng * 0.5 : x.close - rng * 0.5) : null };
}

function run(c, ind, p, sigFn) {
  const trades = [];
  let pos = null, pend = null;
  const cost = (makerIn, makerOut) => (makerIn ? MAKER : TAKER + SLIP) + (makerOut ? MAKER : TAKER + SLIP);
  const close = (i, price, makerOut, why) => {
    const g = ((price - pos.entry) / pos.entry) * 100 * (pos.dir === 'long' ? 1 : -1);
    trades.push({ t: c[pos.idx].openTime, dir: pos.dir, gross: g, net: g - cost(true, makerOut), bars: i - pos.idx, why });
    pos = null;
  };
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    let exited = false;
    if (pend) {
      const L = pend.dir === 'long';
      if (L ? x.low < pend.limit : x.high > pend.limit) {
        const f = pend.slPct / 100;
        pos = { dir: pend.dir, entry: pend.limit, idx: i, sl: L ? pend.limit * (1 - f) : pend.limit * (1 + f), target: pend.fixedTarget };
        if (L ? x.low <= pos.sl : x.high >= pos.sl) { close(i, pos.sl, false, 'sl'); exited = true; }
        else if (!pos.target) {
          const m = ind.sma[i];
          if (m !== null && (L ? x.close >= m : x.close <= m)) { close(i, x.close, false, 'meanMkt'); exited = true; }
          else pos.target = null, pos.meanLimit = m;
        }
      }
      pend = null;
    } else if (pos) {
      const L = pos.dir === 'long';
      const lim = pos.target || pos.meanLimit;
      if (L ? x.low <= pos.sl : x.high >= pos.sl) { close(i, L ? Math.min(x.open, pos.sl) : Math.max(x.open, pos.sl), false, 'sl'); exited = true; }
      else if (lim && (L ? x.high > lim : x.low < lim)) { close(i, lim, true, 'tp'); exited = true; }
      else if (!pos.target && ind.sma[i] !== null && (L ? x.close >= ind.sma[i] : x.close <= ind.sma[i])) { close(i, x.close, false, 'meanMkt'); exited = true; }
      else if (p.maxBars && i - pos.idx >= p.maxBars) { close(i, x.close, false, 'time'); exited = true; }
      else if (!pos.target && ind.sma[i] !== null) pos.meanLimit = ind.sma[i];
    }
    if (!pos && !pend && !exited && ind.atr[i] !== null) {
      const s = sigFn(p, c, ind, i);
      if (s) pend = { dir: s.dir, limit: s.dir === 'long' ? x.close * (1 - TICK) : x.close * (1 + TICK), slPct: (p.k * ind.atr[i] / x.close) * 100, fixedTarget: s.fixedTarget };
    }
  }
  return trades;
}

function stats(tr, days) {
  const n = tr.length;
  if (!n) return { n: 0 };
  let gw = 0, gl = 0, eq = 0, peak = 0, dd = 0, wins = 0;
  for (const t of tr) { if (t.net > 0) { gw += t.net; wins++; } else gl -= t.net; eq += t.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const avgGross = tr.reduce((a, t) => a + t.gross, 0) / n;
  return { n, perDay: n / days, win: (wins / n) * 100, pf: gl ? gw / gl : Infinity, net: eq, dd, avgNet: eq / n, avgGross };
}
const yearly = (tr) => { const y = {}; for (const t of tr) { const k = new Date(t.t).getUTCFullYear(); y[k] = (y[k] || 0) + t.net; } return y; };
const f = (v, d = 2) => (v === undefined || !isFinite(v) ? String(v) : v.toFixed(d));

function main() {
  const file = process.argv[2];
  const c5 = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tfs = { '5m': 5, '15m': 15, '30m': 30, '1h': 60 };
  const grids = [];
  for (const tf of Object.keys(tfs)) for (const bb of [1.5, 2, 2.5, 3]) for (const trend of [true, false]) for (const k of [3, 4]) grids.push({ fam: 'A', tf, bb, trend, k });
  for (const tf of ['5m', '15m']) for (const m of [2, 3, 4]) for (const v of [2, 3, 5]) for (const exit of ['mean', 'half']) for (const trend of [true, false]) grids.push({ fam: 'B', tf, m, v, exit, trend, k: 3, maxBars: tf === '5m' ? 48 : 16 });
  console.log(`=== culikResearch: ${grids.length} kombinasi, fee maker ${MAKER}% / taker ${TAKER}%+selip ${SLIP}% per sisi ===`);
  const cache = {};
  const rows = [];
  for (const p of grids) {
    if (!cache[p.tf]) { const c = aggregate(c5, tfs[p.tf]); cache[p.tf] = { c, ind: prep(c) }; }
    const { c, ind } = cache[p.tf];
    const tr = run(c, ind, p, p.fam === 'A' ? sigMR : sigCascade);
    const dev = tr.filter((t) => t.t < SPLIT), hold = tr.filter((t) => t.t >= SPLIT);
    const dDays = (SPLIT - c[0].openTime) / 864e5, hDays = (c.at(-1).openTime - SPLIT) / 864e5;
    const sd = stats(dev, dDays), sh = stats(hold, hDays);
    const label = p.fam === 'A' ? `A ${p.tf} bb=${p.bb}${p.trend ? ' +tren' : ''} k=${p.k}` : `B ${p.tf} m=${p.m} v=${p.v} ${p.exit}${p.trend ? ' +tren' : ''}`;
    rows.push({ p, label, sd, sh, tr, y: yearly(tr) });
  }
  const line = (r) => `${r.label.padEnd(34)} DEV n=${r.sd.n} (${f(r.sd.perDay)}/hr) win=${f(r.sd.win, 0)}% PF=${f(r.sd.pf)} NET=${f(r.sd.net, 1)}% DD=${f(r.sd.dd, 1)}% avg=${f(r.sd.avgNet, 3)} (kotor ${f(r.sd.avgGross, 3)})`
    + ` || HOLD n=${r.sh.n} (${f(r.sh.perDay)}/hr) win=${f(r.sh.win, 0)}% PF=${f(r.sh.pf)} NET=${f(r.sh.net, 1)}% DD=${f(r.sh.dd, 1)}% avg=${f(r.sh.avgNet, 3)}`
    + ` | thn ${Object.entries(r.y).map(([a, b]) => a.slice(2) + ':' + f(b, 0)).join(' ')}`;
  for (const r of rows) console.log(line(r));
  const pass = rows.filter((r) => r.sd.n >= 50 && r.sd.pf > 1.1 && r.sh.n >= 30 && r.sh.pf > 1.05);
  console.log(`\n--- LOLOS (DEV PF>1,1 & n>=50, HOLDOUT PF>1,05 & n>=30): ${pass.length}/${rows.length} ---`);
  for (const r of pass.sort((a, b) => b.sh.net / Math.max(1, b.sh.dd) - a.sh.net / Math.max(1, a.sh.dd))) console.log(line(r));
  const out = process.env.CULIK_JSON;
  if (out) fs.writeFileSync(out, JSON.stringify(rows.map((r) => ({ label: r.label, p: r.p, dev: r.sd, hold: r.sh, y: r.y, net: r.tr.map((t) => [t.t, +t.net.toFixed(4)]) }))));
}

if (require.main === module) main();
module.exports = { aggregate, prep, run, sigMR, sigCascade, stats };
