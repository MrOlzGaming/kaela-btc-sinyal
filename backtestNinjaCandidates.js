// backtestNinjaCandidates.js (30 Sep 2026) -- cari pengganti entry NINJA (timeframe rendah 5M/15M/
// 1H, exit trailing) dari ide yang PUNYA bukti publik, setelah Channel Breakout 5M (rugi di live) dan
// FVG-touch (gagal net-of-fee, lihat backtestNinjaFvg.js) sama-sama gagal. Permintaan Olan: "ada ga
// sistem yang bagus, yang singkat, dan kita bisa ambil tp trailing? smart money konsep gimana?"
//
// Kandidat (sumber publik, dicek 30 Sep 2026):
//   DONCHIAN -- trend-following: close tembus high/low N candle sebelumnya -> masuk searah.
//     Dasar: Zarattini, Pagani, Barbon (2025) "Catching Crypto Trends" (SSRN 5209907), ensemble
//     Donchian + trailing; QuantPedia multi-timeframe trend BTC.
//   SWEEP -- liquidity sweep / "Turtle Soup" (Linda Raschke), komponen Smart Money Concept yang
//     paling konsisten di pengujian mekanis: low nembus low N candle sebelumnya (stop hunt) tapi
//     CLOSE balik di atasnya -> LONG (mirror buat SHORT).
//   + filter tren opsional: cuma searah EMA200 timeframe yang sama.
//
// Aturan eksekusi (dibikin MIRIP LIVE, beda dari backtest CB lama yang isi di level teoretis):
//   - sinyal dari candle CLOSED i -> entry di OPEN candle i+1 (bukan harga ideal)
//   - SL awal & jarak trailing = k x ATR14 (dalam % harga saat entry), ratchet satu arah
//   - di tiap candle: cek stop DULU pakai SL lama, baru ratchet pakai high/low (konservatif)
//   - gap nembus SL -> exit di OPEN (lebih jelek dari SL)
//   - 1 posisi aktif, sinyal selama posisi aktif diabaikan, candle yang nutup gak boleh buka lagi
// Satuan & metrik SAMA PERSIS backtestNinjaFvg.js (% notional, fee round-trip per trade).
//
// Pakai: NINJA_CANDLE_CACHE=/dir NINJA_PERM_ITER=100 node backtestNinjaCandidates.js

const { fetchCandles, summarize } = require('./backtestNinjaFvg');
const { metricProfitFactor, barPermutationTest, deflatedSharpeRatio } = require('./backtest/backtestValidation');

const TF_MINUTES = { '5m': 5, '15m': 15, '1h': 60 };
const FEES_RT = [0.04, 0.10, 0.20];

function atrSeries(c, len = 14) {
  const out = new Array(c.length).fill(null);
  let atr = null;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    atr = atr === null ? tr : (atr * (len - 1) + tr) / len;
    if (i >= len) out[i] = atr;
  }
  return out;
}

function emaSeries(c, len) {
  const out = new Array(c.length).fill(null);
  const k = 2 / (len + 1);
  let e = c[0].close;
  for (let i = 0; i < c.length; i++) { e = i === 0 ? c[0].close : c[i].close * k + e * (1 - k); if (i >= len) out[i] = e; }
  return out;
}

// Sinyal di candle CLOSED i. Return 'long' | 'short' | null.
function signalAt(kind, c, i, n) {
  if (i < n + 1) return null;
  let hh = -Infinity, ll = Infinity;
  for (let j = i - n; j < i; j++) { if (c[j].high > hh) hh = c[j].high; if (c[j].low < ll) ll = c[j].low; }
  const x = c[i];
  if (kind === 'donchian') {
    if (x.close > hh) return 'long';
    if (x.close < ll) return 'short';
  } else if (kind === 'sweep') {
    if (x.low < ll && x.close > ll) return 'long';
    if (x.high > hh && x.close < hh) return 'short';
  }
  return null;
}

function run(c, { kind, n, k, trend }) {
  const atr = atrSeries(c);
  const ema = trend ? emaSeries(c, 200) : null;
  const trades = [];
  let pos = null;
  let pending = null; // sinyal dari candle sebelumnya, dieksekusi di open candle ini
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    let closedNow = false;
    if (!pos && pending) {
      const f = pending.distPct / 100;
      const entry = x.open;
      pos = { dir: pending.dir, entryPrice: entry, entryIdx: i, slDistPct: pending.distPct, extreme: entry, sl: pending.dir === 'long' ? entry * (1 - f) : entry * (1 + f) };
      pending = null;
    }
    if (pos) {
      const f = pos.slDistPct / 100;
      const hit = pos.dir === 'long' ? x.low <= pos.sl : x.high >= pos.sl;
      if (hit) {
        const exitPrice = pos.dir === 'long' ? Math.min(x.open, pos.sl) : Math.max(x.open, pos.sl);
        const grossPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.dir === 'long' ? 1 : -1);
        trades.push({ ...pos, exitPrice, exitIdx: i, grossPct });
        pos = null;
        closedNow = true;
      } else if (pos.dir === 'long' && x.high > pos.extreme) {
        pos.extreme = x.high; pos.sl = Math.max(pos.sl, pos.extreme * (1 - f));
      } else if (pos.dir === 'short' && x.low < pos.extreme) {
        pos.extreme = x.low; pos.sl = Math.min(pos.sl, pos.extreme * (1 + f));
      }
    }
    if (!pos && !closedNow && atr[i] !== null) {
      const dir = signalAt(kind, c, i, n);
      if (dir && (!trend || (ema[i] !== null && (dir === 'long' ? x.close > ema[i] : x.close < ema[i])))) {
        pending = { dir, distPct: (k * atr[i] / x.close) * 100 };
      }
    }
  }
  return trades;
}

const f2 = (x, d = 2) => (x === undefined || x === null || !isFinite(x) ? String(x) : x.toFixed(d));

async function main() {
  const days = 730;
  const endTime = Date.now();
  const startTime = endTime - days * 864e5;
  const candles = {};
  for (const tf of Object.keys(TF_MINUTES)) candles[tf] = await fetchCandles(tf, startTime, endTime);

  const grid = [];
  for (const kind of ['donchian', 'sweep']) for (const n of [20, 50, 100]) for (const k of [2, 3, 4]) for (const trend of [false, true]) grid.push({ kind, n, k, trend });
  const numTrials = grid.length * Object.keys(TF_MINUTES).length;

  const all = [];
  for (const tf of Object.keys(TF_MINUTES)) {
    console.log(`\n=== ${tf.toUpperCase()} (fee 0.10% round-trip; kolom terakhir = NET @0.04/0.20) ===`);
    for (const p of grid) {
      const tr = run(candles[tf], p);
      if (tr.length < 30) { console.log(`${tf} ${JSON.stringify(p)} n=${tr.length} (terlalu sedikit)`); continue; }
      const s = summarize(tr, TF_MINUTES[tf], days, 0.10);
      const s04 = summarize(tr, TF_MINUTES[tf], days, 0.04);
      const s20 = summarize(tr, TF_MINUTES[tf], days, 0.20);
      const half = Math.floor(tr.length / 2);
      const netOf = (arr) => arr.reduce((a, t) => a + t.grossPct - 0.10, 0);
      const years = {};
      for (const t of tr) { const y = new Date(candles[tf][t.entryIdx].closeTime).getUTCFullYear(); years[y] = (years[y] || 0) + t.grossPct - 0.10; }
      all.push({ tf, p, s, tr });
      console.log(`${tf} ${p.kind.padEnd(8)} n=${String(p.n).padStart(3)} k=${p.k} trend=${p.trend ? 'Y' : 'N'} | trade=${String(s.n).padStart(5)} (${f2(s.perDay, 1)}/hr) win=${f2(s.winNet, 1)}% PFg=${f2(s.pfGross)} PFnet=${f2(s.pfNet)} NET=${f2(s.netSumPct, 1)}% `
        + `maxDD=${f2(s.maxDdPct, 1)}% hold=${f2(s.medianHoldMin, 0)}m cepat=${f2(s.quickClosePct, 1)}% reentry=${f2(s.reentryPct, 1)}% best=${f2(s.bestTradePct)}% `
        + `| paruh ${f2(netOf(tr.slice(0, half)), 1)}/${f2(netOf(tr.slice(half)), 1)} | thn ${Object.entries(years).map(([y, v]) => `${y}:${f2(v, 1)}`).join(' ')} | @0.04 ${f2(s04.netSumPct, 1)} @0.20 ${f2(s20.netSumPct, 1)}`);
    }
  }

  const iters = Number(process.env.NINJA_PERM_ITER || 50);
  console.log(`\n=== VALIDASI KETAT: 5 terbaik NET @0.10% (trials=${numTrials}, perm iter=${iters}, metrik perm = rata2 net/trade) ===`);
  const top = [...all].sort((a, b) => b.s.netSumPct - a.s.netSumPct).slice(0, 5);
  for (const r of top) {
    const net = r.tr.map((t) => t.grossPct - 0.10);
    const dsr = deflatedSharpeRatio(net, numTrials);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const perm = barPermutationTest(candles[r.tf], (cs) => run(cs, r.p).map((t) => t.grossPct - 0.10), mean, { iterations: iters });
    console.log(`${r.tf} ${JSON.stringify(r.p)} NET=${f2(r.s.netSumPct, 1)}% PFnet=${f2(r.s.pfNet)} n=${r.s.n} | DSR=${dsr.ok ? f2(dsr.dsr * 100, 1) + '%' : dsr.error} | perm p=${perm.ok ? f2(perm.pValue, 3) : perm.error} (null mean ${perm.ok ? f2(perm.nullMean, 3) : '-'}%/trade vs asli ${f2(mean(net), 3)}%/trade)`);
  }
}

if (require.main === module) main().catch((e) => { console.error('ERROR:', e.stack); process.exit(1); });

module.exports = { run, signalAt, atrSeries, emaSeries };
