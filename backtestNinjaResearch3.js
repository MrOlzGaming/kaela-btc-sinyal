// backtestNinjaResearch3.js (30 Sep 2026) -- ronde 3 riset pengganti entry NINJA (Olan: "cari terus
// buat ninja"). Ronde sebelumnya (FVG, Donchian, sweep, multi-timeframe, momentum intraday -- 178
// kombinasi) SEMUA gagal, lihat BACKTEST-REGISTRY.md bagian Ninja. Ronde ini nyoba KELAS pola yang
// belum kesentuh sama sekali:
//
//   MR  -- mean reversion, kebalikan breakout (breakout timeframe rendah terbukti gagal -> apa
//          fade-nya yang punya edge?): close di luar Bollinger(20, 2.5) -> masuk BALIK arah.
//          Opsi "buy the dip searah tren": cuma fade yang searah EMA200.
//   VOL -- breakout Donchian yang dikonfirmasi volume (volume candle >= m x rata2 20 candle) +
//          opsional cuma di jam ramai (13:00-20:00 UTC, overlap sesi Eropa/AS).
//   SQZ -- squeeze breakout: lebar Bollinger di level terendah 100 candle (volatilitas kompres),
//          lalu close tembus band -> masuk searah tembusan.
//
// Exit: 'trail' = trailing k x ATR (permintaan Olan, TP trailing), 'mean' (khusus MR) = keluar pas
// close balik nyentuh SMA20 atau kena SL k x ATR -- dua-duanya diuji biar kelihatan mana yg cocok.
// Eksekusi & metrik SAMA backtestNinjaCandidates.js (entry open candle berikutnya, stop dicek dulu
// baru ratchet, 1 posisi aktif, % notional, fee round-trip per trade).
// Pakai: NINJA_CANDLE_CACHE=/dir NINJA_PERM_ITER=50 node backtestNinjaResearch3.js

const { fetchCandles, summarize } = require('./backtestNinjaFvg');
const { atrSeries, emaSeries } = require('./backtestNinjaCandidates');
const { barPermutationTest, deflatedSharpeRatio } = require('./backtest/backtestValidation');

const TF_MINUTES = { '5m': 5, '15m': 15, '1h': 60 };
const PRIOR_TRIALS = 178; // kombinasi yang udah diuji di ronde 1-2 (masuk hitungan Deflated Sharpe)

function smaStd(c, len) {
  const mean = new Array(c.length).fill(null), sd = new Array(c.length).fill(null);
  for (let i = len - 1; i < c.length; i++) {
    let s = 0, s2 = 0;
    for (let j = i - len + 1; j <= i; j++) { s += c[j].close; s2 += c[j].close * c[j].close; }
    const m = s / len;
    mean[i] = m; sd[i] = Math.sqrt(Math.max(0, s2 / len - m * m));
  }
  return { mean, sd };
}

function prepare(c) {
  const atr = atrSeries(c);
  const ema200 = emaSeries(c, 200);
  const { mean: sma20, sd: sd20 } = smaStd(c, 20);
  const volAvg = new Array(c.length).fill(null);
  let vs = 0;
  for (let i = 0; i < c.length; i++) { vs += c[i].volume || 0; if (i >= 20) vs -= c[i - 20].volume || 0; if (i >= 19) volAvg[i] = vs / 20; }
  const bbw = sma20.map((m, i) => (m && sd20[i] !== null ? (4 * sd20[i]) / m : null));
  return { atr, ema200, sma20, sd20, volAvg, bbw };
}

// Sinyal di candle CLOSED i -> 'long' | 'short' | null
function signal(p, c, ind, i) {
  const x = c[i];
  const up = ind.ema200[i] !== null && x.close > ind.ema200[i];
  const dn = ind.ema200[i] !== null && x.close < ind.ema200[i];
  if (p.kind === 'mr') {
    if (ind.sma20[i] === null) return null;
    const upper = ind.sma20[i] + 2.5 * ind.sd20[i], lower = ind.sma20[i] - 2.5 * ind.sd20[i];
    if (x.close < lower && (!p.trend || up)) return 'long';
    if (x.close > upper && (!p.trend || dn)) return 'short';
    return null;
  }
  if (p.kind === 'vol') {
    if (i < p.n + 1 || ind.volAvg[i - 1] === null) return null;
    if (p.session) { const h = new Date(x.openTime).getUTCHours(); if (h < 13 || h >= 20) return null; }
    if (!(x.volume >= p.m * ind.volAvg[i - 1])) return null;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - p.n; j < i; j++) { hh = Math.max(hh, c[j].high); ll = Math.min(ll, c[j].low); }
    if (x.close > hh) return 'long';
    if (x.close < ll) return 'short';
    return null;
  }
  if (p.kind === 'sqz') {
    // lb = lookback kompresi, tol = toleransi "di dekat titik terendah", bb = pengali band tembusan
    // (default 100 / 1,05 / 2 = versi yang diuji pertama; varian dipakai uji sensitivitas+OOS)
    const lb = p.lb || 100, tol = p.tol || 1.05, bb = p.bb || 2;
    if (i < lb + 1 || ind.bbw[i - 1] === null) return null;
    let minW = Infinity;
    for (let j = i - lb; j < i; j++) if (ind.bbw[j] !== null) minW = Math.min(minW, ind.bbw[j]);
    if (!(ind.bbw[i - 1] <= minW * tol)) return null; // candle sebelumnya lagi di zona kompresi
    const upper = ind.sma20[i] + bb * ind.sd20[i], lower = ind.sma20[i] - bb * ind.sd20[i];
    if (x.close > upper) return 'long';
    if (x.close < lower) return 'short';
    return null;
  }
  return null;
}

function run(c, p) {
  const ind = prepare(c);
  const trades = [];
  let pos = null, pending = null;
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    let closedNow = false;
    if (!pos && pending) {
      const f = pending.distPct / 100, e = x.open;
      pos = { dir: pending.dir, entryPrice: e, entryIdx: i, slDistPct: pending.distPct, extreme: e, sl: pending.dir === 'long' ? e * (1 - f) : e * (1 + f) };
      pending = null;
    }
    if (pos) {
      const f = pos.slDistPct / 100;
      const hit = pos.dir === 'long' ? x.low <= pos.sl : x.high >= pos.sl;
      let exitPrice = null;
      if (hit) exitPrice = pos.dir === 'long' ? Math.min(x.open, pos.sl) : Math.max(x.open, pos.sl);
      else if (p.exit === 'mean' && ind.sma20[i] !== null && (pos.dir === 'long' ? x.close >= ind.sma20[i] : x.close <= ind.sma20[i])) exitPrice = x.close;
      else if (p.maxHoldBars && i - pos.entryIdx + 1 >= p.maxHoldBars) exitPrice = x.close; // time-stop (riset venue fee 0 + biaya inap)
      if (exitPrice !== null) {
        trades.push({ ...pos, exitPrice, exitIdx: i, grossPct: ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.dir === 'long' ? 1 : -1) });
        pos = null; closedNow = true;
      } else if (p.exit === 'trail') {
        if (pos.dir === 'long' && x.high > pos.extreme) { pos.extreme = x.high; pos.sl = Math.max(pos.sl, pos.extreme * (1 - f)); }
        if (pos.dir === 'short' && x.low < pos.extreme) { pos.extreme = x.low; pos.sl = Math.min(pos.sl, pos.extreme * (1 + f)); }
      }
    }
    if (!pos && !closedNow && ind.atr[i] !== null) {
      const dir = signal(p, c, ind, i);
      if (dir) pending = { dir, distPct: (p.k * ind.atr[i] / x.close) * 100 };
    }
  }
  return trades;
}

const f2 = (x, d = 2) => (x === undefined || x === null || !isFinite(x) ? String(x) : x.toFixed(d));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);

async function main() {
  const days = 730;
  const endTime = Date.now();
  const startTime = endTime - days * 864e5;
  const candles = {};
  for (const tf of Object.keys(TF_MINUTES)) candles[tf] = await fetchCandles(tf, startTime, endTime);

  const grid = [];
  for (const tf of Object.keys(TF_MINUTES)) {
    for (const trend of [false, true]) for (const k of [2, 3]) for (const exit of ['trail', 'mean']) grid.push({ tf, kind: 'mr', trend, k, exit });
    for (const n of [20, 50]) for (const m of [2, 3]) for (const session of [false, true]) grid.push({ tf, kind: 'vol', n, m, session, k: 3, exit: 'trail' });
    for (const k of [2, 3, 4]) grid.push({ tf, kind: 'sqz', k, exit: 'trail' });
  }
  const totalTrials = PRIOR_TRIALS + grid.length;
  console.log(`=== RONDE 3: ${grid.length} kombinasi (kumulatif ${totalTrials}), fee 0.10% RT; kolom akhir NET @0.04/0.20 ===`);
  const res = [];
  for (const p of grid) {
    const c = candles[p.tf];
    const tr = run(c, p);
    const label = `${p.tf} ${p.kind}${p.trend ? '+trend' : ''}${p.n ? ' n=' + p.n : ''}${p.m ? ' vol>=' + p.m + 'x' : ''}${p.session ? ' 13-20UTC' : ''} k=${p.k} exit=${p.exit}`;
    if (tr.length < 30) { console.log(`${label.padEnd(44)} n=${tr.length} (terlalu sedikit)`); continue; }
    const tfMin = TF_MINUTES[p.tf];
    const s = summarize(tr, tfMin, days, 0.10);
    const half = Math.floor(tr.length / 2);
    const netOf = (arr) => sum(arr.map((t) => t.grossPct - 0.10));
    const years = {};
    for (const t of tr) { const y = new Date(c[t.entryIdx].closeTime).getUTCFullYear(); years[y] = (years[y] || 0) + t.grossPct - 0.10; }
    res.push({ p, s, tr, label });
    console.log(`${label.padEnd(44)} trade=${String(s.n).padStart(5)} (${f2(s.perDay, 2)}/hr) win=${f2(s.winNet, 1)}% PFg=${f2(s.pfGross)} PFnet=${f2(s.pfNet)} NET=${f2(s.netSumPct, 1)}% maxDD=${f2(s.maxDdPct, 1)}% `
      + `hold=${f2(s.medianHoldMin, 0)}m cepat=${f2(s.quickClosePct, 1)}% | paruh ${f2(netOf(tr.slice(0, half)), 1)}/${f2(netOf(tr.slice(half)), 1)} | thn ${Object.entries(years).map(([y, v]) => `${y}:${f2(v, 1)}`).join(' ')} `
      + `| @0.04 ${f2(summarize(tr, tfMin, days, 0.04).netSumPct, 1)} @0.20 ${f2(summarize(tr, tfMin, days, 0.20).netSumPct, 1)}`);
  }
  console.log(`-> net positif @0.10%: ${res.filter((r) => r.s.netSumPct > 0).length}/${res.length}; PF GROSS > 1.2: ${res.filter((r) => r.s.pfGross > 1.2).length}`);

  const iters = Number(process.env.NINJA_PERM_ITER || 50);
  console.log(`\n--- validasi 5 terbaik (trials kumulatif ${totalTrials}, perm iter=${iters}, metrik rata2 net/trade) ---`);
  for (const r of [...res].sort((a, b) => b.s.netSumPct - a.s.netSumPct).slice(0, 5)) {
    const net = r.tr.map((t) => t.grossPct - 0.10);
    const dsr = deflatedSharpeRatio(net, totalTrials);
    const perm = barPermutationTest(candles[r.p.tf], (cs) => run(cs, r.p).map((t) => t.grossPct - 0.10), mean, { iterations: iters });
    console.log(`${r.label.padEnd(44)} NET=${f2(r.s.netSumPct, 1)}% PFnet=${f2(r.s.pfNet)} n=${r.s.n} | DSR=${dsr.ok ? f2(dsr.dsr * 100, 1) + '%' : dsr.error} | perm p=${perm.ok ? f2(perm.pValue, 3) : perm.error} (acak ${perm.ok ? f2(perm.nullMean, 3) : '-'} vs asli ${f2(mean(net), 3)} %/trade)`);
  }
}

if (require.main === module) main().catch((e) => { console.error('ERROR:', e.stack); process.exit(1); });

module.exports = { run, signal, prepare };
