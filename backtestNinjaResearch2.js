// backtestNinjaResearch2.js (30 Sep 2026) -- riset lanjutan pengganti entry NINJA, setelah FVG-touch,
// Donchian, dan liquidity sweep "polos" gagal (backtestNinjaFvg.js, backtestNinjaCandidates.js).
// Olan setuju ("oke silahkan") lanjut 2 arah:
//
// (1) MULTI-TIMEFRAME -- arah dari timeframe BESAR (4H EMA50 / Daily SMA50), entry dari timeframe
//     Ninja (15M/1H) cuma SEARAH. Dasar: QuantPedia "Simple Multi-Timeframe Trend Strategy on
//     Bitcoin" (tren harian + sinyal 1H). Entry yang diuji: Donchian, liquidity sweep, FVG-touch
//     (ninjaFvg.js persis spesifikasi Olan, SL 2x lebar FVG). Arah timeframe besar DIHITUNG DARI
//     candle timeframe kecil yang digabung (bukan data terpisah) -- biar bar-permutation test tetap
//     konsisten (data acak -> tren besarnya ikut acak), dan cuma pakai candle besar yang UDAH CLOSED
//     (gak ada look-ahead).
//
// (2) MOMENTUM INTRADAY -- Shen dkk. (2022) "Bitcoin intraday time-series momentum", Financial
//     Review: return setengah jam pertama (sesi volume tinggi) memprediksi return setengah jam
//     terakhir. BTC 24 jam -> "hari" = UTC 00:00-24:00. Posisi dibuka 23:30 searah sinyal, ditutup
//     24:00 (bukan trailing -- ini desain paper-nya). Varian prediktor: 00:00-00:30, 13:30-14:00
//     (buka sesi AS), 00:00-23:30; ambang |return| 0 / 0,3 / 0,6%. Uji acak = sign-shuffle
//     (pasangan prediktor-target diacak antar hari).
//
// Satuan/metrik SAMA backtestNinjaFvg.js: % notional per trade, fee round-trip dipotong per trade.
// Pakai: NINJA_CANDLE_CACHE=/dir NINJA_PERM_ITER=50 node backtestNinjaResearch2.js

const { fetchCandles, summarize, fvgTrades } = require('./backtestNinjaFvg');
const { run: runCandidate } = require('./backtestNinjaCandidates');
const { metricProfitFactor, barPermutationTest, deflatedSharpeRatio } = require('./backtest/backtestValidation');

const TF_MINUTES = { '15m': 15, '1h': 60 };
const HTF = { '4h-ema50': { ms: 4 * 3600e3, len: 50, kind: 'ema' }, '1d-sma50': { ms: 24 * 3600e3, len: 50, kind: 'sma' } };

// Arah tren timeframe besar per candle kecil i: 'long' | 'short' | null. Pakai candle besar yang
// UDAH SELESAI sebelum candle kecil i (grup dengan index < grup candle i).
function htfTrend(c, { ms, len, kind }) {
  const groupOf = (t) => Math.floor(t / ms);
  const closes = []; // close tiap grup besar yang udah selesai
  const out = new Array(c.length).fill(null);
  let curGroup = groupOf(c[0].openTime), lastClose = c[0].close;
  let ema = null;
  const k = 2 / (len + 1);
  for (let i = 0; i < c.length; i++) {
    const g = groupOf(c[i].openTime);
    if (g !== curGroup) { // grup sebelumnya selesai
      closes.push(lastClose);
      ema = ema === null ? lastClose : lastClose * k + ema * (1 - k);
      curGroup = g;
    }
    if (closes.length >= len) {
      const ma = kind === 'ema' ? ema : closes.slice(-len).reduce((a, b) => a + b, 0) / len;
      const ref = closes[closes.length - 1];
      out[i] = ref > ma ? 'long' : ref < ma ? 'short' : null;
    }
    lastClose = c[i].close;
  }
  return out;
}

function runMtf(c, p) {
  const trend = htfTrend(c, HTF[p.htf]);
  const dirFilter = (dir, i) => trend[i] === dir;
  if (p.entry === 'fvg') return fvgTrades(c, p.tf, { minWidthPct: p.w, maxAgeBars: p.tf === '1h' ? 168 : 288, slMultiple: 2, dirFilter });
  return runCandidate(c, { kind: p.entry, n: p.n, k: p.k, trend: false, dirFilter });
}

// ---------- Momentum intraday ----------
function priceAt(byTime, t) { const x = byTime.get(t); return x === undefined ? null : x; }

function intradayRows(c5) {
  // open harga di menit tertentu = open candle 5m yang mulai di menit itu
  const openAt = new Map();
  for (const x of c5) openAt.set(x.openTime, x.open);
  const day0 = Math.ceil(c5[0].openTime / 864e5) * 864e5;
  const rows = [];
  for (let d = day0; d + 864e5 <= c5[c5.length - 1].openTime; d += 864e5) {
    const at = (min) => priceAt(openAt, d + min * 60e3);
    const p0 = at(0), p30 = at(30), p1330 = at(810), p1400 = at(840), p2330 = at(1410), p2400 = at(1440);
    if ([p0, p30, p1330, p1400, p2330, p2400].some((v) => v === null)) continue;
    rows.push({
      day: d,
      pred: { first30: (p30 / p0 - 1) * 100, us30: (p1400 / p1330 - 1) * 100, rest: (p2330 / p0 - 1) * 100 },
      target: (p2400 / p2330 - 1) * 100,
    });
  }
  return rows;
}

function intradayTrades(rows, predKey, thr) {
  return rows.filter((r) => Math.abs(r.pred[predKey]) > thr).map((r) => ({ day: r.day, grossPct: Math.sign(r.pred[predKey]) * r.target }));
}

const f2 = (x, d = 2) => (x === undefined || x === null || !isFinite(x) ? String(x) : x.toFixed(d));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);

function yearSplit(trades, timeOf, fee) {
  const y = {};
  for (const t of trades) { const k = new Date(timeOf(t)).getUTCFullYear(); y[k] = (y[k] || 0) + t.grossPct - fee; }
  return Object.entries(y).map(([k, v]) => `${k}:${f2(v, 1)}`).join(' ');
}

async function main() {
  const days = 730;
  const endTime = Date.now();
  const startTime = endTime - days * 864e5;
  const candles = {};
  for (const tf of ['5m', ...Object.keys(TF_MINUTES)]) candles[tf] = await fetchCandles(tf, startTime, endTime);
  const iters = Number(process.env.NINJA_PERM_ITER || 50);

  // ===== (1) MULTI-TIMEFRAME =====
  const entries = [
    { entry: 'donchian', n: 20 }, { entry: 'donchian', n: 50 },
    { entry: 'sweep', n: 20 }, { entry: 'sweep', n: 50 },
    { entry: 'fvg', w: 0.1 }, { entry: 'fvg', w: 0.3 },
  ];
  const grid = [];
  for (const tf of Object.keys(TF_MINUTES)) for (const htf of Object.keys(HTF)) for (const e of entries) {
    if (e.entry === 'fvg') grid.push({ tf, htf, ...e });
    else for (const k of [3, 4]) grid.push({ tf, htf, ...e, k });
  }
  console.log(`=== (1) MULTI-TIMEFRAME: ${grid.length} kombinasi, fee 0.10% RT (kolom akhir = NET @0.04/0.20) ===`);
  const res = [];
  for (const p of grid) {
    const c = candles[p.tf];
    const tr = runMtf(c, p);
    const label = `${p.tf} ${p.htf} ${p.entry}${p.n ? '-' + p.n : ''}${p.w ? ' w>=' + p.w : ''}${p.k ? ' k=' + p.k : ''}`;
    if (tr.length < 30) { console.log(`${label.padEnd(34)} n=${tr.length} (terlalu sedikit)`); continue; }
    const s = summarize(tr, TF_MINUTES[p.tf], days, 0.10);
    const half = Math.floor(tr.length / 2);
    const netOf = (arr) => sum(arr.map((t) => t.grossPct - 0.10));
    res.push({ p, s, tr, label });
    console.log(`${label.padEnd(34)} trade=${String(s.n).padStart(4)} (${f2(s.perDay, 2)}/hr) win=${f2(s.winNet, 1)}% PFg=${f2(s.pfGross)} PFnet=${f2(s.pfNet)} NET=${f2(s.netSumPct, 1)}% maxDD=${f2(s.maxDdPct, 1)}% `
      + `hold=${f2(s.medianHoldMin, 0)}m cepat=${f2(s.quickClosePct, 1)}% | paruh ${f2(netOf(tr.slice(0, half)), 1)}/${f2(netOf(tr.slice(half)), 1)} | thn ${yearSplit(tr, (t) => c[t.entryIdx].closeTime, 0.10)} `
      + `| @0.04 ${f2(summarize(tr, TF_MINUTES[p.tf], days, 0.04).netSumPct, 1)} @0.20 ${f2(summarize(tr, TF_MINUTES[p.tf], days, 0.20).netSumPct, 1)}`);
  }
  const positive = res.filter((r) => r.s.netSumPct > 0).length;
  console.log(`-> net positif @0.10%: ${positive}/${res.length}`);
  console.log(`\n--- validasi 5 terbaik (trials=${grid.length + 108 + 30}, termasuk riset sebelumnya; perm iter=${iters}, metrik = rata2 net/trade) ---`);
  for (const r of [...res].sort((a, b) => b.s.netSumPct - a.s.netSumPct).slice(0, 5)) {
    const net = r.tr.map((t) => t.grossPct - 0.10);
    const dsr = deflatedSharpeRatio(net, grid.length + 108 + 30);
    const perm = barPermutationTest(candles[r.p.tf], (cs) => runMtf(cs, r.p).map((t) => t.grossPct - 0.10), mean, { iterations: iters });
    console.log(`${r.label.padEnd(34)} NET=${f2(r.s.netSumPct, 1)}% PFnet=${f2(r.s.pfNet)} n=${r.s.n} | DSR=${dsr.ok ? f2(dsr.dsr * 100, 1) + '%' : dsr.error} | perm p=${perm.ok ? f2(perm.pValue, 3) : perm.error} (acak ${perm.ok ? f2(perm.nullMean, 3) : '-'} vs asli ${f2(mean(net), 3)} %/trade, n acak ~${perm.ok ? f2(perm.nullMeanTradeCount, 0) : '-'})`);
  }

  // ===== (2) MOMENTUM INTRADAY =====
  const rows = intradayRows(candles['5m']);
  console.log(`\n=== (2) MOMENTUM INTRADAY (Shen dkk. 2022): ${rows.length} hari, posisi 23:30-24:00 UTC ===`);
  for (const predKey of ['first30', 'us30', 'rest']) {
    for (const thr of [0, 0.3, 0.6]) {
      const tr = intradayTrades(rows, predKey, thr);
      if (tr.length < 30) { console.log(`${predKey} |r|>${thr}%: n=${tr.length} (terlalu sedikit)`); continue; }
      const g = tr.map((t) => t.grossPct);
      const line = [0, 0.04, 0.10, 0.20].map((fee) => `@${fee}: NET=${f2(sum(g) - fee * g.length, 1)}% PF=${f2(metricProfitFactor(g.map((x) => x - fee)))}`).join(' | ');
      // sign-shuffle: acak pasangan prediktor-target antar hari, hitung rata2 GROSS -> p-value edge arah
      const obs = mean(g);
      let ge = 0;
      const targets = rows.filter((r) => Math.abs(r.pred[predKey]) > thr).map((r) => r.target);
      const signs = rows.filter((r) => Math.abs(r.pred[predKey]) > thr).map((r) => Math.sign(r.pred[predKey]));
      for (let it = 0; it < 2000; it++) {
        const sh = [...signs];
        for (let a = sh.length - 1; a > 0; a--) { const b = Math.floor(Math.random() * (a + 1)); [sh[a], sh[b]] = [sh[b], sh[a]]; }
        if (mean(sh.map((s, idx) => s * targets[idx])) >= obs) ge++;
      }
      const half = Math.floor(tr.length / 2);
      console.log(`${predKey.padEnd(7)} |r|>${thr}% n=${String(tr.length).padStart(3)} win(gross)=${f2(g.filter((x) => x > 0).length / g.length * 100, 1)}% rata2 GROSS=${f2(obs, 4)}%/trade | ${line} `
        + `| sign-shuffle p=${f2(ge / 2000, 3)} | paruh gross ${f2(sum(g.slice(0, half)), 1)}/${f2(sum(g.slice(half)), 1)} | thn gross ${yearSplit(tr, (t) => t.day, 0)}`);
    }
  }
}

if (require.main === module) main().catch((e) => { console.error('ERROR:', e.stack); process.exit(1); });

module.exports = { htfTrend, runMtf, intradayRows, intradayTrades };
